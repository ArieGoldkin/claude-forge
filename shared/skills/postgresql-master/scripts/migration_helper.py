#!/usr/bin/env python3
"""
Alembic Migration Helper

Generate, validate, and manage Alembic database migrations.

Usage:
    source .env.db && python migration_helper.py --auto-generate "Add last_login_at to user"
    source .env.db && python migration_helper.py --create "Add index on user_activities"
    source .env.db && python migration_helper.py --validate
    source .env.db && python migration_helper.py --dry-run
    source .env.db && python migration_helper.py --current
    source .env.db && python migration_helper.py --history
"""

import os
import sys
import subprocess
import argparse
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))


def run_command(cmd: list, capture_output=False):
    """Run a shell command."""
    try:
        result = subprocess.run(
            cmd,
            cwd=project_root,
            capture_output=capture_output,
            text=True,
            check=True
        )
        return result.stdout if capture_output else None
    except subprocess.CalledProcessError as e:
        print(f"❌ Command failed: {' '.join(cmd)}")
        if e.stderr:
            print(f"   Error: {e.stderr}")
        sys.exit(1)


def auto_generate_migration(message: str):
    """Auto-generate migration from model changes."""
    print(f"\n🔄 Generating migration: {message}")
    print("=" * 60)

    # Check if alembic is configured
    alembic_ini = project_root / "alembic.ini"
    if not alembic_ini.exists():
        print("❌ ERROR: alembic.ini not found in project root")
        sys.exit(1)

    # Run alembic revision --autogenerate
    cmd = ["alembic", "revision", "--autogenerate", "-m", message]
    print(f"   Running: {' '.join(cmd)}")

    run_command(cmd)

    print("\n✅ Migration generated successfully")
    print("\n📝 Next steps:")
    print("   1. Review the generated migration in alembic/versions/")
    print("   2. Validate with: python migration_helper.py --validate")
    print("   3. Test locally: alembic upgrade head")
    print("   4. Commit and deploy after code review")


def create_empty_migration(message: str):
    """Create an empty migration for manual changes."""
    print(f"\n📝 Creating empty migration: {message}")
    print("=" * 60)

    cmd = ["alembic", "revision", "-m", message]
    print(f"   Running: {' '.join(cmd)}")

    run_command(cmd)

    print("\n✅ Empty migration created successfully")
    print("\n📝 Next steps:")
    print("   1. Edit the generated migration in alembic/versions/")
    print("   2. Implement upgrade() and downgrade() functions")
    print("   3. Validate with: python migration_helper.py --validate")
    print("   4. Test locally: alembic upgrade head")


def validate_migrations():
    """Validate migration syntax and connectivity."""
    print("\n🔍 Validating migrations...")
    print("=" * 60)

    # Check database connectivity
    print("\n1️⃣  Checking database connectivity...")
    try:
        from utils.database.db_utils import get_db_engine

        db_secret = os.environ.get("DB_SECRET_NAME")
        db_name = os.environ.get("DB_NAME")
        db_host = os.environ.get("DB_HOST")
        db_port = os.environ.get("DB_PORT", "5432")

        if not all([db_secret, db_name, db_host]):
            print("   ⚠️  WARNING: Environment variables not set")
            print("   Required: DB_SECRET_NAME, DB_NAME, DB_HOST")
            print("   Hint: source .env.db")
        else:
            engine = get_db_engine(db_secret, db_name, db_host, db_port)
            with engine.connect() as conn:
                print("   ✅ Database connection successful")

    except Exception as e:
        print(f"   ❌ Database connection failed: {e}")

    # Check current migration state
    print("\n2️⃣  Checking current migration state...")
    try:
        output = run_command(["alembic", "current"], capture_output=True)
        print(f"   {output.strip()}")
    except Exception as e:
        print(f"   ❌ Failed to get current revision: {e}")

    # Check for pending migrations
    print("\n3️⃣  Checking for pending migrations...")
    try:
        output = run_command(["alembic", "heads"], capture_output=True)
        heads = output.strip()

        output = run_command(["alembic", "current"], capture_output=True)
        current = output.strip()

        if heads != current:
            print(f"   ⚠️  Pending migrations detected")
            print(f"   Current: {current}")
            print(f"   Target:  {heads}")
        else:
            print("   ✅ No pending migrations")

    except Exception as e:
        print(f"   ⚠️  Could not check pending migrations: {e}")

    print("\n✅ Validation complete")


def dry_run():
    """Preview SQL without applying migrations."""
    print("\n🔍 Generating SQL preview (dry run)...")
    print("=" * 60)

    cmd = ["alembic", "upgrade", "head", "--sql"]
    print(f"   Running: {' '.join(cmd)}\n")

    run_command(cmd)


def show_current():
    """Show current migration revision."""
    print("\n📍 Current Migration Revision:")
    print("=" * 60)

    output = run_command(["alembic", "current", "-v"], capture_output=True)
    print(output)


def show_history():
    """Show migration history."""
    print("\n📜 Migration History:")
    print("=" * 60)

    output = run_command(["alembic", "history", "-v"], capture_output=True)
    print(output)


def upgrade_to_head():
    """Upgrade database to latest migration."""
    print("\n⬆️  Upgrading database to HEAD...")
    print("=" * 60)
    print("   ⚠️  WARNING: This will modify the database")
    print("   Ensure you have a backup before proceeding\n")

    response = input("   Continue? [y/N]: ")
    if response.lower() != 'y':
        print("   ❌ Aborted")
        sys.exit(0)

    cmd = ["alembic", "upgrade", "head"]
    print(f"\n   Running: {' '.join(cmd)}")

    run_command(cmd)

    print("\n✅ Database upgraded successfully")


def downgrade_by_one():
    """Downgrade database by one revision."""
    print("\n⬇️  Downgrading database by one revision...")
    print("=" * 60)
    print("   ⚠️  WARNING: This will modify the database")
    print("   Ensure you have a backup before proceeding\n")

    response = input("   Continue? [y/N]: ")
    if response.lower() != 'y':
        print("   ❌ Aborted")
        sys.exit(0)

    cmd = ["alembic", "downgrade", "-1"]
    print(f"\n   Running: {' '.join(cmd)}")

    run_command(cmd)

    print("\n✅ Database downgraded successfully")


def main():
    parser = argparse.ArgumentParser(
        description="Alembic Migration Helper for Acme Platform"
    )

    # Migration generation
    parser.add_argument(
        "--auto-generate",
        type=str,
        metavar="MESSAGE",
        help="Auto-generate migration from model changes"
    )
    parser.add_argument(
        "--create",
        type=str,
        metavar="MESSAGE",
        help="Create empty migration for manual changes"
    )

    # Migration management
    parser.add_argument(
        "--validate",
        action="store_true",
        help="Validate migrations and database connectivity"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview SQL without applying (alembic upgrade head --sql)"
    )
    parser.add_argument(
        "--current",
        action="store_true",
        help="Show current migration revision"
    )
    parser.add_argument(
        "--history",
        action="store_true",
        help="Show migration history"
    )
    parser.add_argument(
        "--upgrade",
        action="store_true",
        help="Upgrade database to latest migration (alembic upgrade head)"
    )
    parser.add_argument(
        "--downgrade",
        action="store_true",
        help="Downgrade database by one revision (alembic downgrade -1)"
    )

    args = parser.parse_args()

    # Execute requested operation
    if args.auto_generate:
        auto_generate_migration(args.auto_generate)
    elif args.create:
        create_empty_migration(args.create)
    elif args.validate:
        validate_migrations()
    elif args.dry_run:
        dry_run()
    elif args.current:
        show_current()
    elif args.history:
        show_history()
    elif args.upgrade:
        upgrade_to_head()
    elif args.downgrade:
        downgrade_by_one()
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
