import { firebaseConfig, ADMIN_UID } from './firebase-config.js?v=4.0.0';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import { getAuth,onAuthStateChanged,signInWithEmailAndPassword,createUserWithEmailAndPassword,signOut,updateProfile } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import { getFirestore,collection,addDoc,updateDoc,deleteDoc,doc,onSnapshot,serverTimestamp,setDoc,getDoc,getDocs,increment } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);
const $ = id => document.getElementById(id);
let posts=[], user=null, current=null, filter='all', signup=false, unsubComments=null;

const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const fmt=t=>{try{return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(t?.toDate?t.toDate():new Date(t))}catch{return''}};
const cat=p=>p.category==='research'?'RESEARCH':'FIELD NOTES';
const img=p=>p.image||'./hero-mountain.jpg';

function card(p,small=false){
  return `<article class="card" data-post="${p.id}">
    <img class="thumb" src="${esc(img(p))}" alt="">
    <div class="eyebrow">${cat(p)}</div><h3>${esc(p.title)}</h3>
    ${small?'':`<p>${esc(p.summary||'')}</p>`}<span class="date">${fmt(p.createdAt)}</span>
  </article>`;
}
function bind(){document.querySelectorAll('[data-post]').forEach(e=>e.onclick=()=>openArticle(e.dataset.post))}
function render(){
  let f=posts.filter(p=>p.featured).slice(0,3); if(!f.length) f=posts.slice(0,3);
  $('featured').innerHTML=f.length?f.map(p=>card(p)).join(''):'<p class="muted">Your featured posts will appear here</p>';
  let r=filter==='all'?posts:posts.filter(p=>p.category===filter);
  $('recent').innerHTML=r.slice(0,8).map(p=>card(p,true)).join('');
  bind();
}

onSnapshot(collection(db,'posts'),s=>{
  posts=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  render();
}, e=>console.error('posts',e));

onSnapshot(doc(db,'settings','site'),s=>{
  if(!s.exists()) return;
  const x=s.data();
  $('siteTitle').textContent=x.title||'Stacking Ammo';
  $('siteIntro').textContent=(x.intro||'Research, language & ideas worth keeping').replace(/\.+$/,'');
  $('tagline').textContent=(x.tagline||'Keep what matters Stack what you learn').replace(/\./g,'');
  document.title=x.title||'Stacking Ammo';
});

function route(n){
  ['homeView','archiveView','articleView'].forEach(x=>$(x).classList.add('hidden'));
  $('miniLogo').classList.toggle('hidden',n==='home');
  if(n==='home') $('homeView').classList.remove('hidden');
  else {$('archiveView').classList.remove('hidden'); showArchive(n)}
  scrollTo(0,0);
}
function showArchive(t){
  let a=posts;
  if(t==='research') a=posts.filter(p=>p.category==='research');
  if(t==='field') a=posts.filter(p=>p.category==='field');
  $('pageEyebrow').textContent=t==='archive'?'ARCHIVE':t==='research'?'RESEARCH':'FIELD NOTES';
  $('pageTitle').textContent=t==='archive'?'Archive':t==='research'?'Research':'Field Notes';
  $('pageDesc').textContent=t==='archive'?'All posts in one place':t==='research'?'Company research, markets and macro analysis':'English expressions and learning notes';
  renderList(a);
}
function renderList(a){
  $('archivePosts').innerHTML=a.map(p=>`<article class="listitem" data-post="${p.id}">
    <img src="${esc(img(p))}"><div><div class="eyebrow">${cat(p)}</div><h3>${esc(p.title)}</h3><p>${esc(p.summary||'')}</p></div>
    <span class="date">${fmt(p.createdAt)}</span></article>`).join('')||'<p class="muted">No posts yet</p>';
  bind();
}
document.querySelectorAll('[data-route]').forEach(b=>b.onclick=()=>route(b.dataset.route));
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{
  filter=b.dataset.filter; document.querySelectorAll('[data-filter]').forEach(x=>x.classList.remove('active')); b.classList.add('active'); render();
});
$('searchInput').oninput=e=>{const q=e.target.value.toLowerCase();renderList(posts.filter(p=>(p.title+' '+(p.summary||'')+' '+(p.body||'')).toLowerCase().includes(q)))};
$('searchBtn').onclick=()=>{route('archive');setTimeout(()=>$('searchInput').focus(),50)};

async function openArticle(id){
  current=posts.find(p=>p.id===id); if(!current)return;
  $('homeView').classList.add('hidden');$('archiveView').classList.add('hidden');$('articleView').classList.remove('hidden');$('miniLogo').classList.remove('hidden');
  $('articleMeta').textContent=`${cat(current)} · PUBLISHED ${fmt(current.createdAt)}${current.updatedAt?' · UPDATED '+fmt(current.updatedAt):''}`;
  $('articleTitle').textContent=current.title;$('articleSummary').textContent=current.summary||'';$('articleBody').textContent=current.body||'';
  if(current.image){$('articleImage').src=current.image;$('articleImage').classList.remove('hidden')}else $('articleImage').classList.add('hidden');
  $('reactionCount').textContent=current.reactionCount||0;
  const admin=user?.uid===ADMIN_UID;$('editPostBtn').classList.toggle('hidden',!admin);$('deletePostBtn').classList.toggle('hidden',!admin);
  loadComments();scrollTo(0,0);
}
function loadComments(){
  if(!current)return;if(unsubComments)unsubComments();
  unsubComments=onSnapshot(collection(db,'posts',current.id,'comments'),s=>{
    $('commentsList').innerHTML=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.createdAt?.seconds||0)-(b.createdAt?.seconds||0)).map(c=>`<div class="comment"><div class="comment-head"><b>${esc(c.displayName||'Reader')}</b><span>${fmt(c.createdAt)}</span></div><p>${esc(c.text)}</p>${user&&(user.uid===c.uid||user.uid===ADMIN_UID)?`<button data-dc="${c.id}">DELETE</button>`:''}</div>`).join('')||'<p class="muted">No comments yet</p>';
    document.querySelectorAll('[data-dc]').forEach(b=>b.onclick=()=>deleteDoc(doc(db,'posts',current.id,'comments',b.dataset.dc)));
  });
}
$('postComment').onclick=async()=>{const t=$('commentText').value.trim();if(!user||!t)return;await addDoc(collection(db,'posts',current.id,'comments'),{uid:user.uid,displayName:user.displayName||'Reader',text:t,createdAt:serverTimestamp()});$('commentText').value=''};
$('reactBtn').onclick=async()=>{
  if(!user){openModal('authModal');return}
  const ref=doc(db,'posts',current.id,'reactions',user.uid),s=await getDoc(ref);
  if(s.exists())return alert('You already reacted to this post');
  await setDoc(ref,{uid:user.uid,createdAt:serverTimestamp()});
  await updateDoc(doc(db,'posts',current.id),{reactionCount:increment(1)});
};
$('copyBtn').onclick=async()=>{await navigator.clipboard.writeText(location.href.split('#')[0]+'#post-'+current.id);$('copyBtn').textContent='COPIED';setTimeout(()=>$('copyBtn').textContent='COPY LINK',1000)};

function openModal(id){$(id).classList.add('show')}
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).classList.remove('show'));
$('accountBtn').onclick=()=>user?(confirm(`Signed in as ${user.displayName||user.email}. Sign out?`)&&signOut(auth)):openModal('authModal');
$('authSwitch').onclick=()=>{signup=!signup;$('displayName').classList.toggle('hidden',!signup);$('authTitle').textContent=signup?'Create account':'Sign in';$('authSubmit').textContent=signup?'CREATE ACCOUNT':'SIGN IN';$('authSwitch').textContent=signup?'Already have an account? Sign in':'New here? Create an account'};
$('authSubmit').onclick=async()=>{
  try{
    $('authStatus').textContent='Signing in…';
    const email=$('email').value.trim(), password=$('password').value;
    let c;
    if(signup){c=await createUserWithEmailAndPassword(auth,email,password);await updateProfile(c.user,{displayName:$('displayName').value.trim()||'Reader'})}
    else c=await signInWithEmailAndPassword(auth,email,password);
    $('authStatus').textContent='';$('authModal').classList.remove('show');
  }catch(e){
    console.error(e);
    const friendly={
      'auth/invalid-credential':'Email or password is incorrect',
      'auth/invalid-email':'Please check the email address',
      'auth/too-many-requests':'Too many attempts Please try again later',
      'auth/unauthorized-domain':'This site domain must be authorized in Firebase',
      'auth/api-key-not-valid.-please-pass-a-valid-api-key.':'Firebase API key is invalid'
    };
    $('authStatus').textContent=friendly[e.code]||`${e.code||'Login error'} ${e.message||''}`;
  }
};

onAuthStateChanged(auth,u=>{
  user=u;const a=u?.uid===ADMIN_UID;
  $('adminBar').classList.toggle('hidden',!a);$('commentComposer').classList.toggle('hidden',!u);$('commentLoginHint').classList.toggle('hidden',!!u);
  if(current){$('editPostBtn').classList.toggle('hidden',!a);$('deletePostBtn').classList.toggle('hidden',!a);loadComments()}
});

function clearEditor(){['editId','postTitle','postSummary','postBody','postImage'].forEach(x=>$(x).value='');$('postFeatured').checked=false}
$('newPost').onclick=()=>{clearEditor();openModal('adminModal')};
$('settingsBtn').onclick=async()=>{await fillSettings();openModal('adminModal')};
$('clearPost').onclick=clearEditor;
$('savePost').onclick=async()=>{
  const d={category:$('postCategory').value,title:$('postTitle').value.trim(),summary:$('postSummary').value.trim(),body:$('postBody').value.trim(),image:$('postImage').value.trim(),featured:$('postFeatured').checked,updatedAt:serverTimestamp()};
  if(!d.title||!d.body)return alert('Title and article are required');
  if($('editId').value)await updateDoc(doc(db,'posts',$('editId').value),d);
  else await addDoc(collection(db,'posts'),{...d,createdAt:serverTimestamp(),reactionCount:0});
  clearEditor();alert('Saved');
};
$('editPostBtn').onclick=()=>{if(!current)return;$('editId').value=current.id;$('postCategory').value=current.category;$('postTitle').value=current.title;$('postSummary').value=current.summary||'';$('postBody').value=current.body||'';$('postImage').value=current.image||'';$('postFeatured').checked=!!current.featured;openModal('adminModal')};
$('deletePostBtn').onclick=async()=>{if(current&&confirm('Delete this post?')){await deleteDoc(doc(db,'posts',current.id));route('home')}};

async function fillSettings(){
  const s=await getDoc(doc(db,'settings','site')),x=s.exists()?s.data():{};
  $('setTitle').value=x.title||'Stacking Ammo';
  $('setIntro').value=(x.intro||'Research, language & ideas worth keeping').replace(/\.+$/,'');
  $('setTagline').value=(x.tagline||'Keep what matters Stack what you learn').replace(/\./g,'');
}
$('saveSettings').onclick=async()=>{
  await setDoc(doc(db,'settings','site'),{
    title:$('setTitle').value.trim().replace(/\.+$/,''),
    intro:$('setIntro').value.trim().replace(/\.+$/,''),
    tagline:$('setTagline').value.trim().replace(/\./g,'')
  },{merge:true});alert('Site copy saved');
};
$('exportBackup').onclick=async()=>{
  const ps=await getDocs(collection(db,'posts')),out=[];
  for(const p of ps.docs){const cs=await getDocs(collection(db,'posts',p.id,'comments'));out.push({id:p.id,...p.data(),comments:cs.docs.map(c=>({id:c.id,...c.data()}))})}
  const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),posts:out},null,2)],{type:'application/json'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download='stacking-ammo-backup.json';a.click();URL.revokeObjectURL(a.href);
};
$('footerYear').textContent=new Date().getFullYear();
if(location.hash.startsWith('#post-'))setTimeout(()=>openArticle(location.hash.slice(6)),1000);
