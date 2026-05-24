import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

db_url = os.getenv("DATABASE_URL")
engine = create_engine(db_url)

with engine.connect() as conn:
    # Check users
    result = conn.execute(text("SELECT * FROM users"))
    users = result.fetchall()
    print(f"Users in DB: {len(users)}")
    for u in users:
        print(u)

    # Check user_organizations
    result = conn.execute(text("SELECT * FROM user_organizations"))
    user_orgs = result.fetchall()
    print(f"User Organizations in DB: {len(user_orgs)}")
    for uo in user_orgs:
        print(uo)
