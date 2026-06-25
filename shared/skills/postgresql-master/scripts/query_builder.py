#!/usr/bin/env python3
"""
PostgreSQL Query Builder

Build and execute safe, parameterized queries with export capabilities.

Usage:
    source .env.db && python query_builder.py --table user --limit 10
    source .env.db && python query_builder.py --table user --where "created_at > '2025-01-01'" --limit 10
    source .env.db && python query_builder.py --query "SELECT * FROM users WHERE email = :email" --params '{"email": "user@example.com"}'
    source .env.db && python query_builder.py --table events --where "event_type = 'login'" --export-csv events.csv
"""

import os
import sys
import json
import csv
import argparse
from pathlib import Path
from typing import Dict, Any, List

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
        print("   Hint: source .env.db && python query_builder.py ...")
        sys.exit(1)

    return get_db_engine(db_secret, db_name, db_host, db_port)


def build_select_query(
    table: str,
    schema: str = "acme_models",
    where: str = None,
    columns: str = "*",
    limit: int = None,
    offset: int = None
) -> str:
    """Build a SELECT query string."""
    query = f"SELECT {columns} FROM {schema}.{table}"

    if where:
        query += f" WHERE {where}"

    if limit:
        query += f" LIMIT {limit}"

    if offset:
        query += f" OFFSET {offset}"

    return query


def execute_query(
    engine,
    query: str,
    params: Dict[str, Any] = None
) -> List[Dict[str, Any]]:
    """Execute a query and return results as list of dicts."""
    with engine.connect() as conn:
        result = conn.execute(text(query), params or {})

        # Fetch column names
        columns = result.keys()

        # Fetch all rows
        rows = result.fetchall()

        # Convert to list of dicts
        return [dict(zip(columns, row)) for row in rows]


def print_results(results: List[Dict[str, Any]], max_col_width: int = 30):
    """Print results in a formatted table."""
    if not results:
        print("\n   No results found")
        return

    # Get column names
    columns = list(results[0].keys())

    # Calculate column widths
    widths = {}
    for col in columns:
        max_width = len(col)
        for row in results:
            val_len = len(str(row[col]))
            max_width = max(max_width, min(val_len, max_col_width))
        widths[col] = max_width

    # Print header
    print("\n" + "=" * (sum(widths.values()) + len(columns) * 3 + 1))
    header = " | ".join(col.ljust(widths[col]) for col in columns)
    print(f"| {header} |")
    print("=" * (sum(widths.values()) + len(columns) * 3 + 1))

    # Print rows
    for row in results:
        values = []
        for col in columns:
            val = str(row[col])
            if len(val) > max_col_width:
                val = val[:max_col_width-3] + "..."
            values.append(val.ljust(widths[col]))

        print(f"| {' | '.join(values)} |")

    print("=" * (sum(widths.values()) + len(columns) * 3 + 1))
    print(f"\n   Total rows: {len(results)}")


def export_to_csv(results: List[Dict[str, Any]], filename: str):
    """Export results to CSV file."""
    if not results:
        print("❌ No results to export")
        return

    with open(filename, 'w', newline='') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=results[0].keys())
        writer.writeheader()
        writer.writerows(results)

    print(f"\n✅ Exported {len(results)} rows to: {filename}")


def export_to_json(results: List[Dict[str, Any]], filename: str):
    """Export results to JSON file."""
    if not results:
        print("❌ No results to export")
        return

    with open(filename, 'w') as jsonfile:
        json.dump(results, jsonfile, indent=2, default=str)

    print(f"\n✅ Exported {len(results)} rows to: {filename}")


def main():
    parser = argparse.ArgumentParser(
        description="PostgreSQL Query Builder for Acme Platform"
    )

    # Query options
    parser.add_argument(
        "--table",
        type=str,
        help="Table name for simple SELECT queries"
    )
    parser.add_argument(
        "--query",
        type=str,
        help="Custom SQL query (use :param for parameters)"
    )
    parser.add_argument(
        "--where",
        type=str,
        help="WHERE clause (use with --table)"
    )
    parser.add_argument(
        "--columns",
        type=str,
        default="*",
        help="Columns to select (default: *)"
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Limit number of results"
    )
    parser.add_argument(
        "--offset",
        type=int,
        help="Offset for pagination"
    )
    parser.add_argument(
        "--schema",
        type=str,
        default="acme_models",
        help="Schema name (default: acme_models)"
    )
    parser.add_argument(
        "--params",
        type=str,
        help='Query parameters as JSON string, e.g., \'{"email": "user@example.com"}\''
    )

    # Export options
    parser.add_argument(
        "--export-csv",
        type=str,
        metavar="FILENAME",
        help="Export results to CSV file"
    )
    parser.add_argument(
        "--export-json",
        type=str,
        metavar="FILENAME",
        help="Export results to JSON file"
    )

    # Display options
    parser.add_argument(
        "--max-col-width",
        type=int,
        default=30,
        help="Maximum column width for display (default: 30)"
    )

    args = parser.parse_args()

    # Validate arguments
    if not args.table and not args.query:
        parser.error("Must specify either --table or --query")

    # Parse parameters
    params = {}
    if args.params:
        try:
            params = json.loads(args.params)
        except json.JSONDecodeError as e:
            print(f"❌ ERROR: Invalid JSON in --params: {e}")
            sys.exit(1)

    # Get database connection
    engine = get_connection()

    # Build or use custom query
    if args.query:
        query = args.query
        print(f"\n🔍 Executing custom query:")
        print(f"   {query}")
        if params:
            print(f"   Parameters: {params}")
    else:
        query = build_select_query(
            table=args.table,
            schema=args.schema,
            where=args.where,
            columns=args.columns,
            limit=args.limit,
            offset=args.offset
        )
        print(f"\n🔍 Executing query:")
        print(f"   {query}")

    # Execute query
    try:
        results = execute_query(engine, query, params)

        # Display results
        if not args.export_csv and not args.export_json:
            print_results(results, args.max_col_width)

        # Export if requested
        if args.export_csv:
            export_to_csv(results, args.export_csv)

        if args.export_json:
            export_to_json(results, args.export_json)

    except Exception as e:
        print(f"\n❌ Query failed: {type(e).__name__}")
        print(f"   {str(e)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
