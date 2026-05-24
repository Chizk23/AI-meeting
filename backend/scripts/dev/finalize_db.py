from sqlalchemy import text
from src.api.database import SessionLocal

def finalize():
    db = SessionLocal()
    try:
        # Add group_id if not exists
        db.execute(text("ALTER TABLE meetings ADD COLUMN group_id VARCHAR(36) AFTER organization_id"))
        db.commit()
        print("group_id added.")
    except Exception as e:
        print(f"Note: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    import os, sys
    sys.path.append(os.getcwd())
    finalize()
