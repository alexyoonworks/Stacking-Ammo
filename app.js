
import { firebaseConfig, ADMIN_UID } from './firebase-config.js?v=5.0.0';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, updateProfile, signOut
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  setDoc, getDoc, getDocs, onSnapshot, serverTimestamp,
  increment, writeBatch
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';

// Stacking Ammo 5.0 — Auth and all posts live in Firebase, never localStorage.
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);

let posts = [];
let currentUser = null;
let currentPostId = null;
let currentComments = [];
let commentUnsubscribe = null;
let currentFilter = 'all';
let authIsSignup = false;
let siteSettings = {};
let initialPostsLoaded = false;
let toastTimeout;

const defaultSettings = Object.freeze({
  archiveDescription: 'All posts, collected over time',
  researchDescription: 'Company research, markets and macro analysis',
  fieldDescription: 'English expressions, language practice and learning notes',
  footerNote: 'A living archive of research and ideas'
});

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function safeImageUrl(s) {
  try {
    const u = new URL(String(s || ''), location.href);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch { return ''; }
}

function formatDate(ts) {
  if (!ts) return '';
  const d = typeof ts.toDate === 'function' ? ts.toDate() :
    typeof ts.seconds === 'number' ? new Date(ts.seconds * 1000) : new Date(ts);
  return isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', day: 'numeric'
  }).format(d);
}

function getYear(ts) {
  if (!ts) return 'UNDATED';
  const date = typeof ts.toDate === 'function' ? ts.toDate() :
    typeof ts.seconds === 'number' ? new Date(ts.seconds * 1000) : new Date(ts);
  return isNaN(date.getTime()) ? 'UNDATED' : String(date.getFullYear());
}

function unixTime(ts) {
  if (!ts) return 0;
  if (typeof ts.seconds === 'number') return ts.seconds;
  const date = new Date(ts);
  return isNaN(date.getTime()) ? 0 : date.getTime() / 1000;
}

function categoryLabel(p) { return p.category === 'research' ? 'RESEARCH' : 'FIELD NOTES'; }
function admin() { return !!currentUser && currentUser.uid === ADMIN_UID; }
function showToast(msg) {
  $('toast').textContent = msg;
  $('toast').classList.remove('hidden');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => $('toast').classList.add('hidden'), 3300);
}

function showDataError(msg) { $('dataError').textContent = msg; $('dataError').classList.remove('hidden'); }
function friendlyError(err) {
  const c = String(err?.code || '').toLowerCase();
  if (c.includes('api-key-not-valid') || c.includes('invalid-api-key')) return 'Firebase API key is invalid. Please check the GitHub firebase-config.js file against Firebase Console.';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'Email or password is incorrect. Use the Firebase Authentication account.';
  if (c.includes('email-already-in-use')) return 'This email already has an account. Sign in instead.';
  if (c.includes('weak-password')) return 'Please use a stronger password (at least 6 characters).';
  if (c.includes('invalid-email')) return 'Please enter a valid email address.';
  if (c.includes('too-many-requests')) return 'Too many attempts. Please wait a little before trying again.';
  if (c.includes('unauthorized-domain')) return 'Add alexyoonworks.github.io under Firebase Authentication → Settings → Authorized domains.';
  if (c.includes('permission-denied') || c.includes('insufficient-permission')) return 'Firestore permission denied. Please check the published rules and account.';
  if (c.includes('network-request-failed') || c.includes('unavailable')) return 'Network error. Check your connection and try again.';
  return err?.message || 'Something went wrong. Please try again.';
}

function coverHtml(p, klass = 'card-cover') {
  const url = safeImageUrl(p.image);
  if (url) return `<img class="${klass}" src="${escapeHtml(url)}" loading="lazy" alt="Cover image for ${escapeHtml(p.title)}">`;
  return `<div class="${klass} no-image" aria-hidden="true"></div>`;
}

function cardHtml(p, compact = false) {
  return `<article class="post-card" tabindex="0" role="link" data-post-id="${escapeHtml(p.id)}">
    ${coverHtml(p)}
    <div class="eyebrow">${categoryLabel(p)}</div>
    <h3 class="card-title">${escapeHtml(p.title)}</h3>
    ${compact ? '' : `<p class="card-summary">${escapeHtml(p.summary || '')}</p>`}
    <div class="post-date">${escapeHtml(formatDate(p.createdAt))}</div>
  </article>`;
}

function postMatches(p, query) {
  return `${p.title || ''} ${p.summary || ''} ${p.body || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function renderHome() {
  const featured = posts.filter(p => p.featured).slice(0, 3);
  const selected = featured.length ? featured : posts.slice(0, 3);
  $('featuredPosts').innerHTML = selected.length ? selected.map(p => cardHtml(p)).join('') :
    '<p class="empty-message">Featured articles will appear here as the archive grows</p>';
  const recent = posts.filter(p => currentFilter === 'all' || p.category === currentFilter).slice(0, 8);
  $('recentPosts').innerHTML = recent.length ? recent.map(p => cardHtml(p, true)).join('') :
    '<p class="empty-message">No posts in this collection yet</p>';
}

function listingMode() {
  const hash = location.hash || '#home';
  if (hash === '#research') return 'research';
  if (hash === '#field') return 'field';
  return 'archive';
}

function renderListing() {
  const mode = listingMode();
  $('listingTitle').textContent = mode === 'research' ? 'Research' : mode === 'field' ? 'Field Notes' : 'Archive';
  $('listingEyebrow').textContent = mode === 'research' ? 'ANALYSIS & IDEAS' : mode === 'field' ? 'LANGUAGE & NOTES' : 'ALL ENTRIES';
  $('listingDescription').textContent = mode === 'research' ? (siteSettings.researchDescription || defaultSettings.researchDescription) :
    mode === 'field' ? (siteSettings.fieldDescription || defaultSettings.fieldDescription) :
    (siteSettings.archiveDescription || defaultSettings.archiveDescription);
  let visible = posts.filter(p => mode === 'archive' || p.category === mode);
  const q = $('archiveSearch').value.trim();
  if (q) visible = visible.filter(p => postMatches(p, q));
  if (!visible.length) {
    $('archiveResults').innerHTML = `<p class="empty-message">${q ? 'No matching posts' : 'No posts yet — the archive starts here'}</p>`;
    return;
  }
  let lastYear = '';
  const html = [];
  for (const p of visible) {
    const year = getYear(p.createdAt);
    if (year !== lastYear) {
      html.push(`<div class="year-divider">${escapeHtml(year)}</div>`);
      lastYear = year;
    }
    html.push(`<article class="archive-entry" tabindex="0" role="link" data-post-id="${escapeHtml(p.id)}">
      ${coverHtml(p, 'archive-cover')}
      <div><div class="eyebrow">${categoryLabel(p)}</div><h2 class="archive-entry-title">${escapeHtml(p.title)}</h2>
      <p class="archive-entry-description">${escapeHtml(p.summary || '')}</p></div>
      <time class="archive-entry-date">${escapeHtml(formatDate(p.createdAt))}</time>
    </article>`);
  }
  $('archiveResults').innerHTML = html.join('');
}

function navigate(route, postId) {
  const hash = route === 'post' ? `#post/${encodeURIComponent(postId)}` : `#${route}`;
  if (location.hash === hash) renderRoute();
  else location.hash = hash;
}

function renderRoute() {
  const hash = location.hash || '#home';
  const isPost = hash.startsWith('#post/');
  const mode = hash === '#research' ? 'research' : hash === '#field' ? 'field' : 'archive';
  const isHome = !isPost && !['#archive', '#research', '#field'].includes(hash);
  $('homeView').classList.toggle('hidden', !isHome);
  $('listingView').classList.toggle('hidden', isHome || isPost);
  $('articleView').classList.toggle('hidden', !isPost);
  $('smallLogo').classList.toggle('hidden', isHome);
  document.querySelectorAll('.primary-nav button').forEach(b => {
    const active = !isHome && !isPost && b.dataset.route === mode;
    if (active) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
  });
  if (isHome) { clearCommentSubscription(); renderHome(); }
  else if (isPost) {
    let postId;
    try { postId = decodeURIComponent(hash.slice(6)); } catch { postId = ''; }
    renderArticle(postId);
  } else { clearCommentSubscription(); renderListing(); }
  window.scrollTo({top: 0, behavior: 'instant'});
}

function clearCommentSubscription() {
  if (commentUnsubscribe) { commentUnsubscribe(); commentUnsubscribe = null; }
  currentComments = [];
  currentPostId = null;
}

function renderArticle(id) {
  const post = posts.find(p => p.id === id);
  if (!post) {
    $('articleTitle').textContent = initialPostsLoaded ? 'Article not found' : 'Loading article';
    $('articleSummary').textContent = '';
    $('articleBody').replaceChildren();
    $('articleCover').classList.add('hidden');
    if (currentPostId) clearCommentSubscription();
    return;
  }
  $('articleMeta').textContent = `${categoryLabel(post)}  /  PUBLISHED ${formatDate(post.createdAt) || 'RECENTLY'}${post.updatedAt ? `  /  UPDATED ${formatDate(post.updatedAt) || 'RECENTLY'}` : ''}`;
  $('articleTitle').textContent = post.title || '';
  $('articleSummary').textContent = post.summary || '';
  const cover = safeImageUrl(post.image);
  $('articleCover').classList.toggle('hidden', !cover);
  if (cover) $('articleCover').src = cover;
  const body = $('articleBody');
  body.replaceChildren();
  for (const paragraph of String(post.body || '').split(/\n\s*\n/)) {
    if (!paragraph.trim()) continue;
    const el = document.createElement('p');
    el.textContent = paragraph.trim();
    body.append(el);
  }
  $('likeCount').textContent = String(Math.max(0, Number(post.reactionCount) || 0));
  $('editButton').classList.toggle('hidden', !admin());
  $('deleteButton').classList.toggle('hidden', !admin());
  if (currentPostId !== id) {
    clearCommentSubscription();
    currentPostId = id;
    subscribeComments(id);
  }
  refreshReactionState(id);
}

function subscribeComments(postId) {
  $('commentList').innerHTML = '<p class="muted">Loading comments…</p>';
  commentUnsubscribe = onSnapshot(collection(db, 'posts', postId, 'comments'), snap => {
    if (currentPostId !== postId) return;
    currentComments = snap.docs.map(d => ({id: d.id, ...d.data()}))
      .sort((a,b) => unixTime(a.createdAt)-unixTime(b.createdAt));
    renderComments();
  }, err => { $('commentList').textContent = friendlyError(err); });
}

function renderComments() {
  $('commentList').innerHTML = currentComments.length ? currentComments.map(c => `
    <div class="comment-item"><div class="comment-header">
      <strong>${escapeHtml(c.displayName || 'Reader')}</strong>
      <time>${escapeHtml(formatDate(c.createdAt))}</time>
    </div><p class="comment-message">${escapeHtml(c.text || '')}</p>
    ${currentUser && (currentUser.uid === c.uid || admin()) ?
      `<button type="button" class="comment-delete" data-comment-id="${escapeHtml(c.id)}">DELETE COMMENT</button>` : ''}
    </div>`).join('') : '<p class="muted">No comments yet — start the conversation</p>';
}

async function refreshReactionState(id) {
  $('likeButton').classList.remove('liked');
  $('likeButton').disabled = false;
  if (!currentUser || !id) return;
  const uid = currentUser.uid;
  try {
    const s = await getDoc(doc(db,'posts',id,'reactions',uid));
    if (currentPostId !== id || currentUser?.uid !== uid) return;
    $('likeButton').classList.toggle('liked', s.exists());
    $('likeButton').setAttribute('aria-label', s.exists() ? 'You appreciated this article' : 'Appreciate this article');
  } catch (err) { console.warn('Reaction state:',err); }
}

// Firestore realtime subscription preserves documents when the website is redesigned.
onSnapshot(collection(db,'posts'), snapshot => {
  initialPostsLoaded = true;
  $('dataError').classList.add('hidden');
  posts = snapshot.docs.map(d => ({id: d.id, ...d.data()}))
    .sort((a,b) => unixTime(b.createdAt)-unixTime(a.createdAt));
  renderHome();
  const hash = location.hash || '#home';
  if (hash.startsWith('#post/')) {
    let id=''; try { id=decodeURIComponent(hash.slice(6)); } catch {}
    renderArticle(id);
  } else if (['#archive','#research','#field'].includes(hash)) renderListing();
},err=>showDataError(`Unable to load posts: ${friendlyError(err)}`));

onSnapshot(doc(db,'settings','site'), snap=>{
  siteSettings = snap.exists() ? snap.data() : {};
  $('footerNote').textContent = siteSettings.footerNote || defaultSettings.footerNote;
  if (['#archive','#research','#field'].includes(location.hash)) renderListing();
},err=>console.warn('Settings:',err));

onAuthStateChanged(auth, user => {
  currentUser = user;
  $('adminBar').classList.toggle('hidden', !admin());
  $('accountButton').classList.toggle('signed-in',!!user);
  $('accountButton').setAttribute('aria-label',user?'Account and sign out':'Sign in');
  $('commentForm').classList.toggle('hidden',!user);
  $('commentSignIn').classList.toggle('hidden',!!user);
  if (currentPostId) {
    $('editButton').classList.toggle('hidden',!admin());
    $('deleteButton').classList.toggle('hidden',!admin());
    renderComments();
    refreshReactionState(currentPostId);
  }
});

// Event delegation handles cards added by realtime updates.
document.addEventListener('click', async e => {
  const button = e.target.closest('[data-route]');
  if (button) { navigate(button.dataset.route); return; }
  const post = e.target.closest('[data-post-id]');
  if (post) { navigate('post',post.dataset.postId); return; }
  const dismiss = e.target.closest('[data-dismiss]');
  if (dismiss) closeDialog(dismiss.dataset.dismiss);
  const commentDelete = e.target.closest('[data-comment-id]');
  if (commentDelete && currentPostId && currentUser) {
    if (!confirm('Delete this comment?')) return;
    try { await deleteDoc(doc(db,'posts',currentPostId,'comments',commentDelete.dataset.commentId)); }
    catch(err) { showToast(friendlyError(err)); }
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.dialog-backdrop').forEach(d => d.classList.add('hidden'));
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-post-id]')) {
    e.preventDefault(); navigate('post',e.target.dataset.postId);
  }
});

window.addEventListener('hashchange',renderRoute);
document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click',()=>{
  currentFilter = b.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(c => c.classList.toggle('selected',c === b));
  renderHome();
}));

$('archiveSearch').addEventListener('input',renderListing);
$('searchButton').addEventListener('click',()=>{
  if (location.hash !== '#archive') navigate('archive');
  $('archiveSearch').focus();
});

function openDialog(id) { $(id).classList.remove('hidden'); }
function closeDialog(id) { $(id).classList.add('hidden'); }
$('authToggle').addEventListener('click',()=>{
  authIsSignup = !authIsSignup;
  $('authNameLabel').classList.toggle('hidden',!authIsSignup);
  $('authHeading').textContent = authIsSignup ? 'Create account' : 'Sign in';
  $('authSubmit').textContent = authIsSignup ? 'CREATE ACCOUNT' : 'SIGN IN';
  $('authToggle').textContent = authIsSignup ? 'Already have an account? Sign in' : 'New here? Create an account';
  $('authPassword').autocomplete = authIsSignup ? 'new-password' : 'current-password';
  $('authError').textContent = '';
});

$('accountButton').addEventListener('click', async ()=>{
  if (currentUser) {
    if (!confirm(`Signed in as ${currentUser.displayName || currentUser.email}. Sign out?`)) return;
    try { await signOut(auth); showToast('Signed out'); }
    catch(err) { showToast(friendlyError(err)); }
  } else { $('authError').textContent = ''; openDialog('authDialog'); }
});

$('authForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const submit = $('authSubmit'); submit.disabled = true;
  $('authError').textContent = '';
  try {
    const email = $('authEmail').value.trim();
    const password = $('authPassword').value;
    if (authIsSignup) {
      const credential = await createUserWithEmailAndPassword(auth,email,password);
      const name = $('authName').value.trim().slice(0,48) || 'Reader';
      await updateProfile(credential.user,{displayName:name});
    } else await signInWithEmailAndPassword(auth,email,password);
    $('authPassword').value = '';
    closeDialog('authDialog');
    showToast('Signed in successfully');
  } catch(err) {
    console.error('Firebase Authentication error:',err.code,err.message);
    $('authError').textContent = friendlyError(err);
  } finally { submit.disabled = false; }
});

$('commentForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const text = $('commentText').value.trim();
  if (!currentUser || !currentPostId || !text) return;
  if (text.length > 1200) return showToast('Maximum 1,200 characters');
  const submit = $('commentForm').querySelector('[type=submit]'); submit.disabled = true;
  try {
    await addDoc(collection(db,'posts',currentPostId,'comments'),{
      uid:currentUser.uid,
      displayName:(currentUser.displayName || 'Reader').slice(0,48),
      text,
      createdAt:serverTimestamp()
    });
    $('commentText').value = '';
  } catch(err) { showToast(friendlyError(err)); }
  finally { submit.disabled = false; }
});

$('likeButton').addEventListener('click',async()=>{
  if (!currentUser) { $('authError').textContent=''; openDialog('authDialog'); return; }
  if (!currentPostId) return;
  const postId = currentPostId;
  const uid = currentUser.uid;
  const button = $('likeButton'); button.disabled = true;
  try {
    const reactionRef=doc(db,'posts',postId,'reactions',uid);
    if ((await getDoc(reactionRef)).exists()) { showToast('You already appreciated this article'); return; }
    // Atomic batch: no reaction is recorded if count update fails, and vice versa.
    const batch=writeBatch(db);
    batch.set(reactionRef,{uid,createdAt:serverTimestamp()});
    batch.update(doc(db,'posts',postId),{reactionCount:increment(1)});
    await batch.commit();
    button.classList.add('liked'); showToast('Thanks for reading');
  } catch(err) { showToast(friendlyError(err)); }
  finally { button.disabled = false; }
});

$('shareButton').addEventListener('click',async()=>{
  try { await navigator.clipboard.writeText(location.href); showToast('Link copied'); }
  catch { showToast('Please copy the address from your browser'); }
});

function openEditor(post=null) {
  if (!admin()) return;
  $('editorForm').reset(); $('editorError').textContent='';
  $('editorId').value=post?.id || '';
  $('editorCategory').value=post?.category === 'field' ? 'field' : 'research';
  $('editorTitle').value=post?.title || '';
  $('editorSummary').value=post?.summary || '';
  $('editorBody').value=post?.body || '';
  $('editorImage').value=post?.image || '';
  $('editorFeatured').checked=!!post?.featured;
  $('editorHeading').textContent=post?'Edit article':'New article';
  $('editorSave').textContent=post?'SAVE CHANGES':'PUBLISH ARTICLE';
  openDialog('editorDialog');
}

$('newPostButton').addEventListener('click',()=>openEditor());
$('editButton').addEventListener('click',()=>openEditor(posts.find(p=>p.id===currentPostId)));
$('editorForm').addEventListener('submit',async e=>{
  e.preventDefault(); if (!admin()) return;
  const id=$('editorId').value;
  const title=$('editorTitle').value.trim();
  const body=$('editorBody').value.trim();
  if (!title || !body) return;
  const image=$('editorImage').value.trim();
  if (image && !safeImageUrl(image)) { $('editorError').textContent='Please use a valid http or https image URL'; return; }
  const record={
    title,body,image,
    summary:$('editorSummary').value.trim(),
    category:$('editorCategory').value,
    featured:$('editorFeatured').checked
  };
  const save=$('editorSave'); save.disabled=true;
  $('editorError').textContent='';
  try {
    let postId=id;
    if (id) await updateDoc(doc(db,'posts',id),{...record,updatedAt:serverTimestamp()});
    else {
      const created=await addDoc(collection(db,'posts'),{...record,createdAt:serverTimestamp(),reactionCount:0});
      postId=created.id;
    }
    closeDialog('editorDialog');
    showToast(id?'Article updated':'Article published');
    navigate('post',postId);
  } catch(err) { $('editorError').textContent=friendlyError(err); }
  finally { save.disabled=false; }
});

$('deleteButton').addEventListener('click',async()=>{
  if (!admin() || !currentPostId || !confirm('Permanently delete this article?')) return;
  const id=currentPostId;
  try {
    // Subcollections in Firestore are not automatically removed with the parent.
    // The published rules allow admins to remove comments, not reaction docs.
    const comments=await getDocs(collection(db,'posts',id,'comments'));
    for (const comment of comments.docs) await deleteDoc(comment.ref);
    await deleteDoc(doc(db,'posts',id));
    navigate('archive'); showToast('Article deleted');
  } catch(err) { showToast(friendlyError(err)); }
});

$('siteSettingsButton').addEventListener('click',()=>{
  if (!admin()) return;
  $('settingsArchive').value=siteSettings.archiveDescription || defaultSettings.archiveDescription;
  $('settingsResearch').value=siteSettings.researchDescription || defaultSettings.researchDescription;
  $('settingsField').value=siteSettings.fieldDescription || defaultSettings.fieldDescription;
  $('settingsFooter').value=siteSettings.footerNote || defaultSettings.footerNote;
  $('settingsError').textContent='';
  openDialog('settingsDialog');
});

$('settingsForm').addEventListener('submit',async e=>{
  e.preventDefault(); if (!admin()) return;
  const button=$('settingsSave');button.disabled=true;
  try {
    await setDoc(doc(db,'settings','site'),{
      archiveDescription:$('settingsArchive').value.trim(),
      researchDescription:$('settingsResearch').value.trim(),
      fieldDescription:$('settingsField').value.trim(),
      footerNote:$('settingsFooter').value.trim()
    },{merge:true});
    closeDialog('settingsDialog');showToast('Site details saved');
  } catch(err) { $('settingsError').textContent=friendlyError(err); }
  finally { button.disabled=false; }
});

$('backupButton').addEventListener('click',async()=>{
  if (!admin()) return;
  const button=$('backupButton'); button.disabled=true;
  try {
    const backup=[];
    const snapshot=await getDocs(collection(db,'posts'));
    for (const p of snapshot.docs) {
      const comments=await getDocs(collection(db,'posts',p.id,'comments'));
      const reactions=await getDocs(collection(db,'posts',p.id,'reactions'));
      backup.push({id:p.id,...p.data(),comments:comments.docs.map(c=>({id:c.id,...c.data()})),reactions:reactions.docs.map(r=>({id:r.id,...r.data()}))});
    }
    const output={project:'stacking-ammo',exportedAt:new Date().toISOString(),settings:siteSettings,posts:backup};
    const blob=new Blob([JSON.stringify(output,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');anchor.href=url;anchor.download='stacking-ammo-backup-'+new Date().toISOString().slice(0,10)+'.json';
    document.body.append(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    showToast('Backup downloaded');
  } catch(err) { showToast(friendlyError(err)); }
  finally { button.disabled=false; }
});

$('copyright').textContent='© '+new Date().getFullYear();
renderHome();
renderRoute();
