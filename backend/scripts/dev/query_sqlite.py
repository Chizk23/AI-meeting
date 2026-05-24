import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[2] / "multiminutes.db"

def check_orgs():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    print("--- Organizations ---")
    cursor.execute("SELECT id, name FROM organizations")
    for row in cursor.fetchall():
        print(row)
        
    print("\n--- Users ---")
    cursor.execute("SELECT id, username, email FROM users")
    for row in cursor.fetchall():
        print(row)
        
    print("\n--- User Organizations ---")
    cursor.execute("SELECT * FROM user_organizations")
    for row in cursor.fetchall():
        print(row)
        
    conn.close()

if __name__ == "__main__":
    check_orgs()
