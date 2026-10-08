import urllib.request,urllib.error,urllib.parse,secrets,sys,json
from pathlib import Path
base=sys.argv[1] if len(sys.argv)>1 else 'http://localhost:4180'
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*a):return None
op=urllib.request.build_opener(NoRedirect())
class Client:
 def __init__(self):self.cookie=''
 def call(self,path,data=None,origin=None):
  headers={'User-Agent':'HappyPetHarbor-FunctionalCheck','Origin':origin or base}
  if self.cookie:headers['Cookie']=self.cookie
  body=urllib.parse.urlencode(data).encode() if data is not None else None
  if body is not None:headers['Content-Type']='application/x-www-form-urlencoded'
  req=urllib.request.Request(base+path,data=body,headers=headers)
  try:r=op.open(req,timeout=30)
  except urllib.error.HTTPError as e:r=e
  ck=r.headers.get('Set-Cookie')
  if ck:self.cookie=ck.split(';')[0]
  return r.code,r.headers,r.read().decode()
checks=0
def expect(value,msg):
 global checks
 if not value:raise AssertionError(msg)
 checks+=1
 print('PASS',msg)
a=Client();b=Client();tag=secrets.token_hex(8);em='qa-'+tag+'@example.invalid';em2='qa-b-'+tag+'@example.invalid';pw=secrets.token_urlsafe(22)
expect(a.call('/cart/')[0]==303,'anonymous cart requires login')
status,h,_=a.call('/shop/add',{'color':'pink','quantity':'2'});expect(status==303 and 'color=pink' in h['Location'],'anonymous add preserves selected color and quantity')
expect(a.call('/account/register',{'email':em,'password':pw,'confirm':pw,'name':'QA customer','terms':'yes','color':'pink','quantity':'2'})[0]==303,'registration and pending cart add')
s=a.call('/cart/')[2];expect('Pink' in s and '$10.00' in s,'account cart shows selected SKU and server subtotal')
expect(b.call('/account/register',{'email':em2,'password':pw,'confirm':pw,'name':'Other QA','terms':'yes'})[0]==303,'second account registration')
expect('Your cart is empty' in b.call('/cart/')[2],'different account cannot view first account cart')
expect(a.call('/cart/update',{'color':'pink','quantity':'3'})[0]==303,'quantity update')
expect(a.call('/cart/update',{'color':'pink','quantity':'-1'})[0]==400,'negative quantity rejected')
expect(a.call('/cart/update',{'color':'pink','quantity':'4'},origin='https://attacker.example')[0]==403,'cross-origin mutation rejected')
expect(a.call('/shop/add',{'color':'unknown','quantity':'1'})[0]==400,'unknown SKU rejected')
expect(a.call('/account/address',{'name':'QA Recipient','street':'123 Test Street','line2':'Unit 2','city':'Addison','state':'IL','zip':'60101','phone':''})[0]==303,'shipping address saved')
expect('QA Recipient' in a.call('/account/')[2],'saved address visible to owner')
expect('QA Recipient' not in b.call('/account/')[2],'address isolated by account')
a.call('/account/logout',{});expect(a.call('/cart/')[0]==303,'logout revokes access')
expect(a.call('/account/login',{'email':em,'password':'wrong-password'})[0]==401,'incorrect password rejected')
c=Client();expect(c.call('/account/login',{'email':em,'password':pw})[0]==303,'new browser session can sign in')
s=c.call('/cart/')[2];expect('$15.00' in s,'cross-device cart persists')
s=c.call('/checkout/')[2];expect('QA Recipient' in s and 'No order or charge' in s,'purchase review displays address and honest payment status')
expect(c.call('/account/address/delete',{})[0]==303,'address deletion')
expect('QA Recipient' not in c.call('/account/')[2],'deleted address removed')
newpw=secrets.token_urlsafe(22)
expect(c.call('/account/password',{'current':pw,'password':newpw,'confirm':newpw})[0]==303,'password change')
expect(c.call('/cart/')[0]==303,'password change revokes sessions')
expect(c.call('/account/login',{'email':em,'password':newpw})[0]==303,'new password works')
expect(c.call('/cart/remove',{'color':'pink'})[0]==303 and 'Your cart is empty' in c.call('/cart/')[2],'cart removal persists')
print('Completed',checks,'checks')
if base.startswith('https://'):
 path=Path('/tmp/hph-qa-cleanup.sql');path.write_text("DELETE FROM customers WHERE email IN ('"+em+"','"+em2+"');\n");print('Production test cleanup SQL saved privately to /tmp/hph-qa-cleanup.sql')
