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

# Login
login_resp = api_call("POST", "http://localhost:5055/api/auth/login",
                       {"email": "david@itak.live", "password": "Wildcats@4113"})
token = login_resp["access_token"]

# List users
users = api_call("GET", "http://localhost:5055/api/auth/users", token=token)
print("=== USERS ===")
for u in users:
    print(f"  {u['username']} ({u['email']}) - role: {u['role']}, active: {u['is_active']}")

# List referral codes
codes = api_call("GET", "http://localhost:5055/api/auth/referral-codes", token=token)
print("\n=== REFERRAL CODES ===")
for c in codes:
    print(f"  {c['code']} -> role: {c['granted_role']}, used: {c['is_used']}")

# Generate a new referral code
new_code = api_call("POST", "http://localhost:5055/api/auth/referral-codes",
                     {"granted_role": "admin"}, token=token)
print(f"\n=== NEW CODE === {new_code['code']} (role: {new_code['granted_role']})")

# Register with new referral code
reg = api_call("POST", "http://localhost:5055/api/auth/register",
               {"username": "adminref", "password": "adminpass123", "email": "admin@test.com",
                "display_name": "Admin Ref", "referral_code": new_code['code']})
print(f"\n=== REGISTER WITH CODE === {reg}")

# Login as new admin
admin_login = api_call("POST", "http://localhost:5055/api/auth/login",
                        {"email": "admin@test.com", "password": "adminpass123"})
if "error" in admin_login:
    print(f"Admin login failed: {admin_login}")
else:
    print(f"Admin login OK: role={admin_login['user']['role']}")
