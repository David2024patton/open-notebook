import asyncio
import bcrypt
from surrealdb import AsyncSurreal

async def main():
    db = AsyncSurreal("ws://surrealdb:8000/rpc")
    await db.connect()
    await db.signin({"username": "root", "password": "root"})
    await db.use("open_notebook", "open_notebook")

    pw_hash = bcrypt.hashpw(b"Wildcats@4113", bcrypt.gensalt(12)).decode()

    result = await db.query(
        "CREATE user SET "
        "username = 'david', "
        "email = 'david@itak.live', "
        "display_name = 'David', "
        "password_hash = '" + pw_hash + "', "
        "role = 'superuser', "
        "is_active = true, "
        "requires_approval = false, "
        "created_at = time::now()"
    )
    print("Result:", result)

    count_result = await db.query("SELECT count() AS c FROM user GROUP ALL")
    print("Total users:", count_result)

    await db.close()

asyncio.run(main())
