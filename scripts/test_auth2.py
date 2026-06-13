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
print(f"Token: {token[:30]}...")

# Verify token works for GET
me = api_call("GET", "http://localhost:5055/api/auth/me", token=token)
print(f"GET /me: {me.get('username', me)}")

# Test approve directly with requests library if available
try:
    import requests
    r = requests.post(
        "http://localhost:5055/api/auth/signup-requests/signup_request:j8ub7lyuju0677oue0ul/review",
        json={"action": "approve"},
        headers={"Authorization": f"Bearer {token}"}
    )
    print(f"requests.post status: {r.status_code}, body: {r.json()}")
except ImportError:
    print("requests not available, trying urllib with debug")
    
    # Debug: show what headers are being sent
    import http.client
    import ssl
    
    parsed = urllib.parse.urlparse("http://localhost:5055/api/auth/signup-requests/signup_request:j8ub7lyuju0677oue0ul/review")
    conn = http.client.HTTPConnection("localhost", 5055)
    body = json.dumps({"action": "approve"})
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        "Content-Length": str(len(body))
    }
    print(f"Sending headers: {headers}")
    conn.request("POST", parsed.path, body=body, headers=headers)
    resp = conn.getresponse()
    print(f"Status: {resp.status}")
    print(f"Response: {resp.read().decode()}")
