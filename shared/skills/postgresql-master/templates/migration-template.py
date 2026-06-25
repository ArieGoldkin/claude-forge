"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}

"""
from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

# revision identifiers, used by Alembic.
revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}


def upgrade() -> None:
    """
    Upgrade schema changes.

    Examples:
        # Add column
        op.add_column('users', sa.Column('phone', sa.String(20), nullable=True))

        # Add index
        op.create_index('idx_users_email', 'users', ['email'], unique=True, schema='acme_models')

        # Add foreign key
        op.create_foreign_key('fk_notes_user_id', 'notes', 'users', ['user_id'], ['id'], source_schema='acme_models', referent_schema='acme_models')

        # Execute raw SQL
        op.execute("UPDATE users SET status = 'active' WHERE status IS NULL")
    """
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    """
    Downgrade schema changes (reverse of upgrade).

    Examples:
        # Remove column
        op.drop_column('users', 'phone')

        # Remove index
        op.drop_index('idx_users_email', table_name='users', schema='acme_models')

        # Remove foreign key
        op.drop_constraint('fk_notes_user_id', 'notes', schema='acme_models', type_='foreignkey')
    """
    ${downgrades if downgrades else "pass"}
