#!/usr/bin/env python3
"""
PostgreSQL Performance Analyzer

Analyze query performance, suggest indexes, and provide optimization recommendations.

Usage:
    source .env.db && python performance_analyzer.py --query "SELECT * FROM users WHERE email = 'user@example.com'"
    source .env.db && python performance_analyzer.py --suggest-indexes --table user
    source .env.db && python performance_analyzer.py --index-usage
    source .env.db && python performance_analyzer.py --slow-queries
    source .env.db && python performance_analyzer.py --table-stats --table user
"""

import os
import sys
import argparse
from pathlib import Path
from typing import Dict, List

# Add project root to path
project_root = Path(__file__).parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from sqlalchemy import text
from utils.database.db_utils import get_db_engine


def get_connection():
    """Get database connection from environment variables."""
    db_secret = os.environ.get("DB_SECRET_NAME")
    db_name = os.environ.get("DB_NAME")
    db_host = os.environ.get("DB_HOST")
    db_port = os.environ.get("DB_PORT", "5432")

    if not all([db_secret, db_name, db_host]):
        print("❌ ERROR: Missing required environment variables")
        print("   Required: DB_SECRET_NAME, DB_NAME, DB_HOST")
        print("   Hint: source .env.db && python performance_analyzer.py ...")
        sys.exit(1)

    return get_db_engine(db_secret, db_name, db_host, db_port)


def analyze_query(engine, query: str):
    """Analyze a query using EXPLAIN ANALYZE."""
    print(f"\n🔍 Analyzing Query:")
    print("=" * 80)
    print(f"{query}\n")

    with engine.connect() as conn:
        # Run EXPLAIN ANALYZE
        explain_query = f"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {query}"

        try:
            result = conn.execute(text(explain_query))
            explain_data = result.scalar()

            # Parse and display results
            plan = explain_data[0]['Plan']

            print("📊 Execution Plan:")
            print("-" * 80)
            print(f"   Node Type: {plan.get('Node Type')}")
            print(f"   Actual Total Time: {plan.get('Actual Total Time', 0):.2f} ms")
            print(f"   Rows Returned: {plan.get('Actual Rows', 0)}")
            print(f"   Planning Time: {explain_data[0].get('Planning Time', 0):.2f} ms")
            print(f"   Execution Time: {explain_data[0].get('Execution Time', 0):.2f} ms")

            # Check for sequential scans
            if 'Seq Scan' in plan.get('Node Type', ''):
                print("\n⚠️  WARNING: Sequential scan detected!")
                print("   Consider adding an index to improve performance")

            # Check for high execution time
            exec_time = explain_data[0].get('Execution Time', 0)
            if exec_time > 100:
                print(f"\n⚠️  WARNING: High execution time ({exec_time:.2f} ms)")
                print("   Consider optimizing this query")

        except Exception as e:
            print(f"❌ Analysis failed: {type(e).__name__}")
            print(f"   {str(e)}")
            sys.exit(1)


def suggest_indexes(engine, table: str, schema: str = "acme_models"):
    """Suggest indexes based on missing indexes and query patterns."""
    print(f"\n💡 Index Suggestions for {schema}.{table}")
    print("=" * 80)

    with engine.connect() as conn:
        # Get columns that might benefit from indexes
        # Look for foreign keys without indexes
        result = conn.execute(text("""
            SELECT
                tc.constraint_name,
                kcu.column_name,
                ccu.table_name AS foreign_table_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_name = :table
              AND tc.table_schema = :schema
        """), {"table": table, "schema": schema})

        fk_columns = [row.column_name for row in result]

        if fk_columns:
            print("\n🔗 Foreign Key Columns (should have indexes):")
            for col in fk_columns:
                # Check if index exists
                idx_result = conn.execute(text("""
                    SELECT indexname
                    FROM pg_indexes
                    WHERE tablename = :table
                      AND schemaname = :schema
                      AND indexdef LIKE :pattern
                """), {
                    "table": table,
                    "schema": schema,
                    "pattern": f"%{col}%"
                })

                has_index = idx_result.fetchone() is not None

                if has_index:
                    print(f"   ✅ {col} (indexed)")
                else:
                    print(f"   ⚠️  {col} (NOT indexed - consider adding)")
                    print(f"      CREATE INDEX idx_{table}_{col} ON {schema}.{table}({col});")

        # Get frequently queried columns (approximate based on data types)
        result = conn.execute(text("""
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = :table
              AND table_schema = :schema
              AND data_type IN ('character varying', 'timestamp without time zone', 'date')
            ORDER BY ordinal_position
        """), {"table": table, "schema": schema})

        search_columns = [row.column_name for row in result if 'email' in row.column_name.lower() or 'created' in row.column_name.lower()]

        if search_columns:
            print("\n🔎 Columns That May Benefit from Indexes:")
            for col in search_columns:
                # Check if index exists
                idx_result = conn.execute(text("""
                    SELECT indexname
                    FROM pg_indexes
                    WHERE tablename = :table
                      AND schemaname = :schema
                      AND indexdef LIKE :pattern
                """), {
                    "table": table,
                    "schema": schema,
                    "pattern": f"%{col}%"
                })

                has_index = idx_result.fetchone() is not None

                if not has_index:
                    print(f"   💡 {col}")
                    print(f"      CREATE INDEX idx_{table}_{col} ON {schema}.{table}({col});")


def show_index_usage(engine, schema: str = "acme_models"):
    """Show index usage statistics."""
    print(f"\n📇 Index Usage Statistics for {schema}")
    print("=" * 80)

    with engine.connect() as conn:
        result = conn.execute(text("""
            SELECT
                schemaname,
                tablename,
                indexname,
                idx_scan,
                idx_tup_read,
                idx_tup_fetch,
                pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
            FROM pg_stat_user_indexes
            WHERE schemaname = :schema
            ORDER BY idx_scan DESC
        """), {"schema": schema})

        print("\n📊 Most Used Indexes:")
        print("-" * 80)

        rows = result.fetchall()
        if not rows:
            print("   No index statistics available")
            return

        # Show top 10 most used
        for row in rows[:10]:
            print(f"   • {row.indexname}")
            print(f"     Table: {row.tablename}")
            print(f"     Scans: {row.idx_scan:,}")
            print(f"     Size: {row.index_size}")
            print()

        # Show unused indexes
        unused = [row for row in rows if row.idx_scan == 0]
        if unused:
            print("\n⚠️  Unused Indexes (consider removing):")
            print("-" * 80)
            for row in unused:
                print(f"   • {row.indexname} on {row.tablename} (Size: {row.index_size})")


def show_table_stats(engine, table: str, schema: str = "acme_models"):
    """Show detailed table statistics."""
    print(f"\n📊 Table Statistics for {schema}.{table}")
    print("=" * 80)

    with engine.connect() as conn:
        # Table size and row count
        result = conn.execute(text("""
            SELECT
                pg_size_pretty(pg_total_relation_size(:full_table)) AS total_size,
                pg_size_pretty(pg_relation_size(:full_table)) AS table_size,
                pg_size_pretty(pg_total_relation_size(:full_table) - pg_relation_size(:full_table)) AS indexes_size,
                (SELECT count(*) FROM """ + schema + "." + table + """) AS row_count
        """), {"full_table": f"{schema}.{table}"})

        stats = result.fetchone()

        print("\n💾 Size Statistics:")
        print(f"   Total Size: {stats.total_size}")
        print(f"   Table Size: {stats.table_size}")
        print(f"   Indexes Size: {stats.indexes_size}")
        print(f"   Row Count: {stats.row_count:,}")

        # Sequential scans vs index scans
        result = conn.execute(text("""
            SELECT
                seq_scan,
                seq_tup_read,
                idx_scan,
                idx_tup_fetch,
                n_tup_ins,
                n_tup_upd,
                n_tup_del
            FROM pg_stat_user_tables
            WHERE schemaname = :schema
              AND relname = :table
        """), {"schema": schema, "table": table})

        scan_stats = result.fetchone()

        if scan_stats:
            print("\n🔍 Access Patterns:")
            print(f"   Sequential Scans: {scan_stats.seq_scan:,}")
            print(f"   Index Scans: {scan_stats.idx_scan:,}")

            if scan_stats.seq_scan > scan_stats.idx_scan and stats.row_count > 1000:
                print("\n   ⚠️  WARNING: More sequential scans than index scans!")
                print("   Consider adding indexes for common query patterns")

            print(f"\n   Inserts: {scan_stats.n_tup_ins:,}")
            print(f"   Updates: {scan_stats.n_tup_upd:,}")
            print(f"   Deletes: {scan_stats.n_tup_del:,}")


def show_slow_queries(engine):
    """Show slow queries from pg_stat_statements (if available)."""
    print("\n🐌 Slow Queries")
    print("=" * 80)
    print("   Note: Requires pg_stat_statements extension")

    with engine.connect() as conn:
        try:
            result = conn.execute(text("""
                SELECT
                    query,
                    calls,
                    total_exec_time,
                    mean_exec_time,
                    max_exec_time
                FROM pg_stat_statements
                ORDER BY mean_exec_time DESC
                LIMIT 10
            """))

            rows = result.fetchall()

            if not rows:
                print("\n   ℹ️  pg_stat_statements extension not available or no data")
                return

            print("\n   Top 10 slowest queries by average execution time:\n")

            for i, row in enumerate(rows, 1):
                query_preview = row.query[:60] + "..." if len(row.query) > 60 else row.query
                print(f"   {i}. {query_preview}")
                print(f"      Calls: {row.calls:,}")
                print(f"      Avg Time: {row.mean_exec_time:.2f} ms")
                print(f"      Max Time: {row.max_exec_time:.2f} ms")
                print()

        except Exception as e:
            print(f"\n   ⚠️  Could not retrieve slow queries: {type(e).__name__}")
            print("   Hint: Enable pg_stat_statements extension")


def main():
    parser = argparse.ArgumentParser(
        description="PostgreSQL Performance Analyzer for Acme Platform"
    )

    parser.add_argument(
        "--query",
        type=str,
        help="Analyze a specific query using EXPLAIN ANALYZE"
    )
    parser.add_argument(
        "--suggest-indexes",
        action="store_true",
        help="Suggest indexes for a table (use with --table)"
    )
    parser.add_argument(
        "--table",
        type=str,
        help="Specify table name"
    )
    parser.add_argument(
        "--schema",
        type=str,
        default="acme_models",
        help="Schema name (default: acme_models)"
    )
    parser.add_argument(
        "--index-usage",
        action="store_true",
        help="Show index usage statistics"
    )
    parser.add_argument(
        "--table-stats",
        action="store_true",
        help="Show detailed table statistics (use with --table)"
    )
    parser.add_argument(
        "--slow-queries",
        action="store_true",
        help="Show slow queries from pg_stat_statements"
    )

    args = parser.parse_args()

    # Get database connection
    engine = get_connection()

    # Execute requested operation
    if args.query:
        analyze_query(engine, args.query)
    elif args.suggest_indexes and args.table:
        suggest_indexes(engine, args.table, args.schema)
    elif args.index_usage:
        show_index_usage(engine, args.schema)
    elif args.table_stats and args.table:
        show_table_stats(engine, args.table, args.schema)
    elif args.slow_queries:
        show_slow_queries(engine)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
