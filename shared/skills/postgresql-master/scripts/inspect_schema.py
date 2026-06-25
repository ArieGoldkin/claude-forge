#!/usr/bin/env python3
"""
PostgreSQL Schema Inspector

Inspect database schemas, tables, columns, relationships, and indexes.
Integrates with acme platform's database utilities.

Usage:
    source .env.db && python inspect_schema.py --list-tables
    source .env.db && python inspect_schema.py --table user --details
    source .env.db && python inspect_schema.py --table user --relationships
    source .env.db && python inspect_schema.py --export-schema
    source .env.db && python inspect_schema.py --table-sizes
    source .env.db && python inspect_schema.py --list-databases
"""

import os
import sys
import json
import argparse
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from utils.database.db_utils import get_db_engine


def get_connection() -> Engine:
    """Get database connection from environment variables."""
    db_secret = os.environ.get("DB_SECRET_NAME")
    db_name = os.environ.get("DB_NAME")
    db_host = os.environ.get("DB_HOST")
    db_port = os.environ.get("DB_PORT", "5432")

    if not all([db_secret, db_name, db_host]):
        print("❌ ERROR: Missing required environment variables")
        print("   Required: DB_SECRET_NAME, DB_NAME, DB_HOST")
        print("   Hint: source .env.db && python inspect_schema.py ...")
        sys.exit(1)

    return get_db_engine(db_secret, db_name, db_host, db_port)


def list_tables(engine: Engine, schema: str = "acme_models"):
    """List all tables in the schema."""
    inspector = inspect(engine)
    tables = inspector.get_table_names(schema=schema)

    print(f"\n📊 Tables in {schema} schema:")
    print("=" * 60)

    if not tables:
        print(f"   No tables found in '{schema}' schema")
        return

    for table in sorted(tables):
        # Get row count
        with engine.connect() as conn:
            result = conn.execute(
                text(f"SELECT COUNT(*) FROM {schema}.{table}")
            )
            count = result.scalar()

        print(f"   • {table:<30} ({count:,} rows)")


def show_table_details(engine: Engine, table: str, schema: str = "acme_models"):
    """Show detailed information about a table."""
    inspector = inspect(engine)

    print(f"\n🔍 Table: {schema}.{table}")
    print("=" * 60)

    # Columns
    columns = inspector.get_columns(table, schema=schema)
    print(f"\n📋 Columns ({len(columns)}):")
    for col in columns:
        nullable = "NULL" if col['nullable'] else "NOT NULL"
        default = f" DEFAULT {col['default']}" if col['default'] else ""
        print(f"   • {col['name']:<30} {str(col['type']):<20} {nullable}{default}")

    # Primary Keys
    pk = inspector.get_pk_constraint(table, schema=schema)
    if pk and pk['constrained_columns']:
        print(f"\n🔑 Primary Key:")
        print(f"   {', '.join(pk['constrained_columns'])}")

    # Indexes
    indexes = inspector.get_indexes(table, schema=schema)
    if indexes:
        print(f"\n📇 Indexes ({len(indexes)}):")
        for idx in indexes:
            unique = "UNIQUE" if idx['unique'] else "NON-UNIQUE"
            cols = ', '.join(idx['column_names'])
            print(f"   • {idx['name']:<30} {unique:<12} ({cols})")

    # Row count and size
    with engine.connect() as conn:
        result = conn.execute(text(f"SELECT COUNT(*) FROM {schema}.{table}"))
        count = result.scalar()

        result = conn.execute(text(f"""
            SELECT pg_size_pretty(pg_total_relation_size('{schema}.{table}'))
        """))
        size = result.scalar()

    print(f"\n💾 Storage:")
    print(f"   Rows: {count:,}")
    print(f"   Size: {size}")


def show_relationships(engine: Engine, table: str, schema: str = "acme_models"):
    """Show foreign key relationships for a table."""
    inspector = inspect(engine)

    print(f"\n🔗 Relationships for {schema}.{table}")
    print("=" * 60)

    # Outgoing foreign keys (this table references others)
    fks = inspector.get_foreign_keys(table, schema=schema)
    if fks:
        print(f"\n➡️  References to other tables ({len(fks)}):")
        for fk in fks:
            ref_table = fk['referred_table']
            ref_schema = fk['referred_schema'] or schema
            local_cols = ', '.join(fk['constrained_columns'])
            ref_cols = ', '.join(fk['referred_columns'])
            print(f"   • {table}.{local_cols} → {ref_schema}.{ref_table}.{ref_cols}")

    # Incoming foreign keys (other tables reference this)
    all_tables = inspector.get_table_names(schema=schema)
    incoming = []
    for other_table in all_tables:
        if other_table == table:
            continue
        other_fks = inspector.get_foreign_keys(other_table, schema=schema)
        for fk in other_fks:
            if fk['referred_table'] == table:
                incoming.append((other_table, fk))

    if incoming:
        print(f"\n⬅️  Referenced by other tables ({len(incoming)}):")
        for other_table, fk in incoming:
            local_cols = ', '.join(fk['constrained_columns'])
            ref_cols = ', '.join(fk['referred_columns'])
            print(f"   • {other_table}.{local_cols} → {table}.{ref_cols}")

    if not fks and not incoming:
        print("\n   No foreign key relationships found")


def export_schema(engine: Engine, schema: str = "acme_models"):
    """Export full schema as JSON."""
    inspector = inspect(engine)
    tables = inspector.get_table_names(schema=schema)

    schema_data = {
        "schema": schema,
        "tables": {}
    }

    for table in tables:
        schema_data["tables"][table] = {
            "columns": inspector.get_columns(table, schema=schema),
            "primary_key": inspector.get_pk_constraint(table, schema=schema),
            "foreign_keys": inspector.get_foreign_keys(table, schema=schema),
            "indexes": inspector.get_indexes(table, schema=schema),
        }

    output_file = f"{schema}_schema.json"
    with open(output_file, 'w') as f:
        json.dump(schema_data, f, indent=2, default=str)

    print(f"\n✅ Schema exported to: {output_file}")


def show_table_sizes(engine: Engine, schema: str = "acme_models"):
    """Show sizes of all tables."""
    with engine.connect() as conn:
        result = conn.execute(text(f"""
            SELECT
                schemaname,
                tablename,
                pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
                pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes
            FROM pg_tables
            WHERE schemaname = :schema
            ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
        """), {"schema": schema})

        print(f"\n💾 Table Sizes in {schema}:")
        print("=" * 60)

        total_size = 0
        for row in result:
            print(f"   • {row.tablename:<30} {row.size}")
            total_size += row.size_bytes

        print("=" * 60)
        from sqlalchemy import text as sql_text
        size_result = conn.execute(
            sql_text("SELECT pg_size_pretty(:bytes)"),
            {"bytes": total_size}
        )
        total_pretty = size_result.scalar()
        print(f"   Total: {total_pretty}")


def list_databases(engine: Engine):
    """List all databases on the server."""
    with engine.connect() as conn:
        result = conn.execute(text("""
            SELECT datname, pg_size_pretty(pg_database_size(datname)) as size
            FROM pg_database
            WHERE datistemplate = false
            ORDER BY datname
        """))

        print("\n📊 Available Databases:")
        print("=" * 60)
        for row in result:
            print(f"   • {row.datname:<30} ({row.size})")


def main():
    parser = argparse.ArgumentParser(
        description="PostgreSQL Schema Inspector for Acme Platform"
    )
    parser.add_argument(
        "--list-tables",
        action="store_true",
        help="List all tables in the schema"
    )
    parser.add_argument(
        "--table",
        type=str,
        help="Specify table name for detailed inspection"
    )
    parser.add_argument(
        "--details",
        action="store_true",
        help="Show detailed table information (use with --table)"
    )
    parser.add_argument(
        "--relationships",
        action="store_true",
        help="Show foreign key relationships (use with --table)"
    )
    parser.add_argument(
        "--export-schema",
        action="store_true",
        help="Export full schema as JSON"
    )
    parser.add_argument(
        "--table-sizes",
        action="store_true",
        help="Show sizes of all tables"
    )
    parser.add_argument(
        "--list-databases",
        action="store_true",
        help="List all databases on the server"
    )
    parser.add_argument(
        "--schema",
        type=str,
        default="acme_models",
        help="Schema name (default: acme_models)"
    )

    args = parser.parse_args()

    # Get database connection
    engine = get_connection()

    # Execute requested operation
    if args.list_databases:
        list_databases(engine)
    elif args.list_tables:
        list_tables(engine, args.schema)
    elif args.table and args.details:
        show_table_details(engine, args.table, args.schema)
    elif args.table and args.relationships:
        show_relationships(engine, args.table, args.schema)
    elif args.export_schema:
        export_schema(engine, args.schema)
    elif args.table_sizes:
        show_table_sizes(engine, args.schema)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
