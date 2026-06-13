import json
import urllib.request

def api_call(method, url, data=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"error": e.code, "detail": e.read().decode()}

# Login as superuser
login = api_call("POST", "http://localhost:5055/api/auth/login",
                 {"email": "david@itak.live", "password": "Wildcats@4113"})
token = login["access_token"]
print(f"Logged in as {login['user']['username']} ({login['user']['role']})")

# Test admin create user
result = api_call("POST", "http://localhost:5055/api/auth/users",
                  {"email": "newadmin@test.com", "username": "newadmin", "password": "temp123456",
                   "display_name": "New Admin", "role": "admin"}, token=token)
print(f"Admin create user: {result}")

# Test login as new user
if "error" not in result:
    login2 = api_call("POST", "http://localhost:5055/api/auth/login",
                      {"email": "newadmin@test.com", "password": "temp123456"})
    if "error" not in login2:
        print(f"New user login OK: role={login2['user']['role']}")
    else:
        print(f"New user login failed: {login2}")
