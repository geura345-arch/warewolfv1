/**
 * ═══════════════════════════════════════════════════════════════
 * WEREWOLF ONLINE — script.js
 * Dark Forest Multiplayer | Pure JavaScript
 * ═══════════════════════════════════════════════════════════════
 *
 * STRUKTUR DATABASE FIREBASE:
 * /rooms/{roomCode}
 *   - code: string
 *   - adminId: string
 *   - maxPlayers: number
 *   - status: "waiting" | "roleReveal" | "day" | "voting" | "night" | "ended"
 *   - day: number
 *   - createdAt: timestamp
 *   - currentEvent: null | "fog" | "eclipse"
 *   - winner: null | "blue" | "red" | "purple" | "yellow"
 *   - nightActions: { playerId: { action, target } }
 *   - votes: { voterId: targetId }
 *   - deadThisNight: [playerId, ...]
 *   - deathMessages: [{ playerId, cause }]
 *
 * /rooms/{roomCode}/players/{playerId}
 *   - id: string
 *   - name: string
 *   - role: string (hanya terlihat oleh diri sendiri + admin logic)
 *   - team: "blue" | "red" | "purple" | "yellow"
 *   - alive: boolean
 *   - avatar: string (emoji)
 *   - hasActed: boolean
 *   - skillCooldown: number
 *   - consecutiveSelfHeal: number
 *
 * /rooms/{roomCode}/messages/{msgId}
 *   - sender: string
 *   - name: string
 *   - text: string
 *   - type: "public" | "wolf" | "dead" | "system"
 *   - timestamp: serverTimestamp
 *
 * SECURITY RULES (Firebase Firestore):
 * Gunakan file firestore.rules yang telah disediakan (v3.0 Production-Safe).
 * JANGAN gunakan rules lama "allow write: if true" di produksi!
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   A. CONSTANTS & ROLE DEFINITIONS
═══════════════════════════════════════════════════════════════ */

const ROLES = {
  // ─── Tim Biru ───────────────────────────────────────────────
  villager: {
    name: 'Penduduk',
    team: 'blue',
    icon: '🏘️',
    desc: 'Penduduk biasa. Bantu tim dengan voting yang tepat!',
    hasPower: false
  },
  seer: {
    name: 'Peramal',
    team: 'blue',
    icon: '🔮',
    desc: 'Dapat melihat tim seorang pemain (20% kemungkinan salah). Cooldown 1 malam.',
    hasPower: true,
    cooldown: 1
  },
  doctor: {
    name: 'Dokter',
    team: 'blue',
    icon: '💊',
    desc: 'Dapat menyembuhkan 1 pemain/malam. Tidak bisa sembuhkan diri sendiri 2x berturut.',
    hasPower: true,
    cooldown: 0
  },
  guard: {
    name: 'Penjaga',
    team: 'blue',
    icon: '🛡️',
    desc: 'Proteksi 1 pemain (80% berhasil). Cooldown 2 malam.',
    hasPower: true,
    cooldown: 2
  },
  witch: {
    name: 'Penyihir',
    team: 'blue',
    icon: '🧙',
    desc: 'Punya 1 ramuan hidup & 1 ramuan mati (sekali pakai masing-masing).',
    hasPower: true,
    cooldown: 0
  },
  hunter: {
    name: 'Pemburu',
    team: 'blue',
    icon: '🏹',
    desc: 'Saat mati, bisa menembak 1 pemain lain ikut mati.',
    hasPower: true,
    cooldown: 0
  },

  // ─── Tim Merah ───────────────────────────────────────────────
  werewolf: {
    name: 'Serigala',
    team: 'red',
    icon: '🐺',
    desc: 'Bunuh 1 pemain/malam. Tidak bisa bunuh target yang sama 2 malam berturut.',
    hasPower: true,
    cooldown: 0
  },
  doppleganger: {
    name: 'Doppleganger',
    team: 'red',
    icon: '👤',
    desc: 'Salin role pemain lain. Berganti tim sesuai role yang disalin.',
    hasPower: true,
    cooldown: 0
  },

  // ─── Tim Ungu ────────────────────────────────────────────────
  vampire: {
    name: 'Vampire',
    team: 'purple',
    icon: '🧛',
    desc: 'Aktif malam GENAP saja. Bisa bunuh werewolf, werewolf tidak bisa membalas.',
    hasPower: true,
    cooldown: 0
  },

  // ─── Tim Kuning ──────────────────────────────────────────────
  joker: {
    name: 'Joker',
    team: 'yellow',
    icon: '🃏',
    desc: 'Menang jika dibunuh atau dieliminasi voting. Ubah strategi!',
    hasPower: false
  }
};

// Alokasi role berdasarkan jumlah pemain
function getRoleDistribution(n) {
  // Jumlah werewolf ~25%, vampire 1 jika ≥8, joker 1 jika ≥7, sisanya biru
  const wolves  = Math.max(1, Math.floor(n * 0.25));
  const hasVamp = n >= 8 ? 1 : 0;
  const hasJoker= n >= 7 ? 1 : 0;
  const hasDopple = wolves >= 2 ? 1 : 0;
  const redCount  = wolves + hasDopple;
  const purpleCount = hasVamp;
  const yellowCount = hasJoker;
  const blueCount = n - redCount - purpleCount - yellowCount;

  const list = [];
  // Blue — distribusikan special roles dulu, sisanya villager
  const blueRoles = ['seer','doctor','guard','witch','hunter'];
  const specialCount = Math.min(blueRoles.length, blueCount);
  list.push(...blueRoles.slice(0, specialCount));
  for(let i = specialCount; i < blueCount; i++) list.push('villager');
  // Red
  for(let i = 0; i < wolves; i++) list.push('werewolf');
  if(hasDopple) list.push('doppleganger');
  // Purple
  if(hasVamp) list.push('vampire');
  // Yellow
  if(hasJoker) list.push('joker');

  return shuffleArray(list);
}

// Emoji avatars
const AVATARS = ['🧑','👱','👩','🧔','👴','👵','🧒','👦','👧','🧑‍🦱','🧑‍🦰','🧑‍🦳','🧑‍🦲','🥷','🧝','🧙‍♂️','🧛','🕵️','👮','🤠'];

/* ═══════════════════════════════════════════════════════════════
   B. STATE MANAGEMENT
═══════════════════════════════════════════════════════════════ */

const State = {
  // Identitas lokal pemain
  playerId: null,
  playerName: null,
  isAdmin: false,
  roomCode: null,

  // Data game dari Firestore
  room: null,
  players: {},      // { id: playerData }
  myRole: null,
  myTeam: null,
  myAlive: true,

  // Witch state (lokal)
  witchHealUsed: false,
  witchPoisonUsed: false,

  // Hunter state
  hunterShotPending: false,

  // Doppleganger
  doppleTarget: null,

  // Voting lokal
  myVote: null,

  // Listeners
  _roomUnsub: null,
  _playersUnsub: null,
  _messagesUnsub: null,
  _wolfMsgUnsub: null,
  _deadMsgUnsub: null,

  // Timers
  _timerInterval: null,
  _timerSeconds: 0,

  // Night action state
  selectedTarget: null,
  actionDone: false,

  reset() {
    this.playerId = null;
    this.playerName = null;
    this.isAdmin = false;
    this.roomCode = null;
    this.room = null;
    this.players = {};
    this.myRole = null;
    this.myTeam = null;
    this.myAlive = true;
    this.witchHealUsed = false;
    this.witchPoisonUsed = false;
    this.hunterShotPending = false;
    this.doppleTarget = null;
    this.myVote = null;
    this.selectedTarget = null;
    this.actionDone = false;
    if(this._roomUnsub)     { this._roomUnsub();     this._roomUnsub = null; }
    if(this._playersUnsub)  { this._playersUnsub();  this._playersUnsub = null; }
    if(this._messagesUnsub) { this._messagesUnsub(); this._messagesUnsub = null; }
    if(this._wolfMsgUnsub)  { this._wolfMsgUnsub();  this._wolfMsgUnsub = null; }
    if(this._deadMsgUnsub)  { this._deadMsgUnsub();  this._deadMsgUnsub = null; }
    if(this._timerInterval) { clearInterval(this._timerInterval); this._timerInterval = null; }
  }
};

/* ═══════════════════════════════════════════════════════════════
   C. FIREBASE HELPERS
═══════════════════════════════════════════════════════════════ */

const DB = {
  get db() { return window._firebaseDB; },
  get m()  { return window._firebaseModules; },

  async getRoom(code) {
    const snap = await this.m.getDoc(this.m.doc(this.db, 'rooms', code));
    return snap.exists() ? snap.data() : null;
  },

  async setRoom(code, data) {
    await this.m.setDoc(this.m.doc(this.db, 'rooms', code), data);
  },

  async updateRoom(code, data) {
    await this.m.updateDoc(this.m.doc(this.db, 'rooms', code), data);
  },

  async setPlayer(code, pid, data) {
    await this.m.setDoc(this.m.doc(this.db, 'rooms', code, 'players', pid), data);
  },

  async updatePlayer(code, pid, data) {
    await this.m.updateDoc(this.m.doc(this.db, 'rooms', code, 'players', pid), data);
  },

  async getAllPlayers(code) {
    const snap = await this.m.getDocs(this.m.collection(this.db, 'rooms', code, 'players'));
    const result = {};
    snap.forEach(d => { result[d.id] = d.data(); });
    return result;
  },

  async addMessage(code, msg) {
    await this.m.addDoc(this.m.collection(this.db, 'rooms', code, 'messages'), {
      ...msg,
      timestamp: this.m.serverTimestamp()
    });
  },

  watchRoom(code, cb) {
    return this.m.onSnapshot(this.m.doc(this.db, 'rooms', code), snap => {
      if(snap.exists()) cb(snap.data());
    });
  },

  watchPlayers(code, cb) {
    return this.m.onSnapshot(this.m.collection(this.db, 'rooms', code, 'players'), snap => {
      const players = {};
      snap.forEach(d => { players[d.id] = d.data(); });
      cb(players);
    });
  },

  watchMessages(code, type, cb) {
    const q = this.m.query(
      this.m.collection(this.db, 'rooms', code, 'messages'),
      this.m.where('type', '==', type)
    );
    return this.m.onSnapshot(q, snap => {
      const msgs = [];
      snap.forEach(d => msgs.push(d.data()));
      msgs.sort((a,b) => (a.timestamp?.seconds||0) - (b.timestamp?.seconds||0));
      cb(msgs);
    });
  }
};

/* ═══════════════════════════════════════════════════════════════
   D. UI MODULE
═══════════════════════════════════════════════════════════════ */

const UI = {
  /** Tampilkan screen tertentu */
  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if(el) el.classList.add('active');

    // Kontrol mic panel
    const gamePanelIds = ['dayScreen','votingScreen','nightScreen','deadScreen'];
    document.getElementById('micPanel').style.display =
      gamePanelIds.includes(id) ? 'flex' : 'none';
  },

  showAdminLogin() {
    document.getElementById('adminLoginModal').style.display = 'flex';
  },

  closeAdminLogin() {
    document.getElementById('adminLoginModal').style.display = 'none';
  },

  showRules() {
    document.getElementById('rulesModal').style.display = 'flex';
  },

  closeRules() {
    document.getElementById('rulesModal').style.display = 'none';
  },

  toast(msg, type='info', duration=3000) {
    const c = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => {
      t.classList.add('toast-hide');
      setTimeout(() => t.remove(), 300);
    }, duration);
  },

  /** Animasi transisi hari/malam */
  async transition(text, duration=2500) {
    return new Promise(resolve => {
      const ov = document.getElementById('transitionOverlay');
      const ct = document.getElementById('transitionContent');
      ct.textContent = text;
      ov.style.display = 'flex';
      ov.style.animation = 'none';
      ov.offsetHeight; // reflow
      ov.style.animation = `transitionFade ${duration/1000}s ease forwards`;
      setTimeout(() => {
        ov.style.display = 'none';
        resolve();
      }, duration);
    });
  },

  /** Animasi aksi role */
  showActionAnim(emoji, duration=1200) {
    const ov = document.getElementById('actionOverlay');
    const an = document.getElementById('actionAnim');
    an.textContent = emoji;
    ov.style.display = 'flex';
    an.style.animation = 'none';
    an.offsetHeight;
    an.style.animation = `actionBurst ${duration/1000}s ease forwards`;
    setTimeout(() => { ov.style.display = 'none'; }, duration);
  },

  /** Flip kartu role */
  flipRoleCard() {
    const card = document.getElementById('roleCard');
    card.classList.add('flipped');
    document.getElementById('revealInstruction').textContent = 'Ini adalah role kamu!';
    document.getElementById('revealCardBtn').textContent = 'Mengerti 👍';
    document.getElementById('revealCardBtn').onclick = () => {
      // Setelah lihat role, lanjut ke game sesuai status
      const status = State.room?.status;
      if(status === 'day')     UI.showScreen('dayScreen');
      else if(status === 'voting') UI.showScreen('votingScreen');
      else if(status === 'night')  UI.showScreen('nightScreen');
      else UI.showScreen('lobbyScreen');
    };
  },

  /** Update kartu role */
  setRoleCard(roleKey) {
    const role = ROLES[roleKey];
    if(!role) return;
    const back = document.getElementById('roleCardBack');
    const teamClass = `team-${role.team}`;
    const badgeClass = `team-${role.team}-badge`;
    back.className = `card-back ${teamClass}`;
    back.innerHTML = `
      <div class="card-role-icon">${role.icon}</div>
      <div class="card-role-name">${role.name}</div>
      <div class="card-role-team ${badgeClass}">${role.team.toUpperCase()}</div>
      <div class="card-role-desc">${role.desc}</div>
    `;
  },

  /** Update lobby player grid */
  renderLobbyPlayers(players, maxPlayers) {
    const grid = document.getElementById('lobbyPlayerGrid');
    const arr = Object.values(players);
    grid.innerHTML = arr.map(p => `
      <div class="player-tile ${p.id === State.playerId ? 'is-me' : ''}">
        <span class="player-avatar">${p.avatar}</span>
        <div class="player-name">${escapeHtml(p.name)}${p.id === State.playerId ? ' (Kamu)':''}</div>
        ${p.id === State.room?.adminId ? '<div style="font-size:0.7rem;color:var(--gold)">👑 Admin</div>' : ''}
      </div>
    `).join('');
    document.getElementById('lobbyPlayerCount').textContent = arr.length;
    document.getElementById('lobbyMaxPlayers').textContent = maxPlayers;
    document.getElementById('lobbyRoomCode').textContent = State.roomCode;
  },

  /** Update admin player list */
  renderAdminPlayers(players) {
    const el = document.getElementById('adminPlayerList');
    const arr = Object.values(players);
    el.innerHTML = arr.map(p => `
      <div class="admin-player-item">
        <span class="player-ready-dot"></span>
        <span>${p.avatar} ${escapeHtml(p.name)}</span>
      </div>
    `).join('') || '<p style="color:var(--text-dim);font-size:0.85rem">Belum ada pemain...</p>';

    const startBtn = document.getElementById('startGameBtn');
    if(startBtn) startBtn.disabled = arr.length < 6;
  },

  /** Render alive players grid */
  renderAlivePlayers(players) {
    const grid = document.getElementById('alivePlayersGrid');
    const alive = Object.values(players).filter(p => p.alive);
    document.getElementById('aliveCount').textContent = alive.length;
    grid.innerHTML = alive.map(p => {
      // Hanya tunjukkan team color jika pemain itu sendiri atau sudah mati (terungkap)
      const teamClass = (p.id === State.playerId) ? `team-${p.team}` : '';
      return `
        <div class="player-tile ${teamClass} ${p.id === State.playerId ? 'is-me' : ''}">
          <span class="player-avatar">${p.avatar}</span>
          <div class="player-name">${escapeHtml(p.name)}</div>
        </div>
      `;
    }).join('');
  },

  /** Render vote candidates */
  renderVoteCandidates(players) {
    const grid = document.getElementById('voteCandidates');
    const alive = Object.values(players).filter(p => p.alive);
    const votes = State.room?.votes || {};

    // Hitung vote per player
    const voteCounts = {};
    Object.values(votes).forEach(tid => {
      voteCounts[tid] = (voteCounts[tid] || 0) + 1;
    });

    grid.innerHTML = alive.map(p => {
      const isMe = p.id === State.playerId;
      const myVote = votes[State.playerId] === p.id;
      const vCount = voteCounts[p.id] || 0;
      return `
        <div class="vote-candidate ${myVote ? 'my-vote':''} ${isMe ? 'is-me-candidate':''}"
             onclick="${isMe ? '' : `Game.castVote('${p.id}')`}">
          ${vCount > 0 ? `<div class="vote-count-badge">${vCount}</div>` : ''}
          <span class="player-avatar">${p.avatar}</span>
          <div class="player-name">${escapeHtml(p.name)}</div>
          ${isMe ? '<div style="font-size:0.7rem;color:var(--text-dim)">(Kamu)</div>' : ''}
        </div>
      `;
    }).join('');

    // Vote bars
    this.renderVoteBars(alive, votes, voteCounts);
  },

  renderVoteBars(alive, votes, voteCounts) {
    const bars = document.getElementById('voteResults');
    const max = Math.max(1, ...Object.values(voteCounts));
    bars.innerHTML = alive.map(p => {
      const c = voteCounts[p.id] || 0;
      const pct = Math.round((c / max) * 100);
      return `
        <div class="vote-bar-row">
          <div class="vote-bar-name">${p.avatar} ${escapeHtml(p.name)}</div>
          <div class="vote-bar-track"><div class="vote-bar-fill" style="width:${pct}%"></div></div>
          <div class="vote-bar-count">${c}</div>
        </div>
      `;
    }).join('');
  },

  /** Render night action panel berdasarkan role */
  renderNightPanel(room, players) {
    const role = State.myRole;
    const panel = document.getElementById('roleActionContent');
    const myRoleBanner = document.getElementById('myRoleBanner');
    const r = ROLES[role];
    if(!r) return;

    // Banner role
    const teamColors = { blue: 'var(--blue)', red: 'var(--red)', purple: 'var(--purple)', yellow: 'var(--yellow)' };
    myRoleBanner.style.background = `rgba(${teamColors[r.team]?.replace('var(','').replace(')','') || '74,158,255'},0.15)`;
    myRoleBanner.innerHTML = `<span>${r.icon}</span><strong>${r.name}</strong><span style="font-size:0.8rem;color:var(--text-dim)">${r.desc}</span>`;

    if(State.actionDone) {
      panel.innerHTML = `<div class="action-status success">✅ Aksi sudah dilakukan. Menunggu pemain lain...</div>`;
      return;
    }

    // Cek event
    const event = room.currentEvent;
    if(event === 'fog') {
      panel.innerHTML = `<div class="action-status fail">🌫️ Malam Berkabut! Semua skill gagal malam ini.</div>`;
      State.actionDone = true;
      return;
    }

    const alive = Object.values(players).filter(p => p.alive && p.id !== State.playerId);
    const aliveAll = Object.values(players).filter(p => p.alive);

    switch(role) {
      case 'villager':
      case 'joker':
        panel.innerHTML = `<div class="action-status">😴 Tidak ada aksi malam hari untuk role kamu. Tunggu pagi...</div>`;
        State.actionDone = true;
        break;

      case 'seer':
        if((State.players[State.playerId]?.skillCooldown || 0) > 0) {
          panel.innerHTML = `<div class="action-status fail">⏳ Skill sedang cooldown. Tunggu ${State.players[State.playerId].skillCooldown} malam.</div>`;
          State.actionDone = true;
        } else {
          panel.innerHTML = `
            <p style="margin-bottom:0.5rem;color:var(--text-dim)">🔮 Lihat tim seorang pemain:</p>
            <div class="action-target-grid">${alive.map(p => `
              <div class="action-target ${State.selectedTarget===p.id?'selected':''}" onclick="Game.selectTarget('${p.id}')">
                <div class="t-avatar">${p.avatar}</div>
                <div class="t-name">${escapeHtml(p.name)}</div>
              </div>`).join('')}
            </div>
            <button class="action-btn btn-see" onclick="Game.doSeer()">🔮 Ramalkan</button>
          `;
        }
        break;

      case 'doctor':
        panel.innerHTML = `
          <p style="margin-bottom:0.5rem;color:var(--text-dim)">💊 Sembuhkan seorang pemain:</p>
          <div class="action-target-grid">${aliveAll.map(p => `
            <div class="action-target ${State.selectedTarget===p.id?'selected':''}" onclick="Game.selectTarget('${p.id}')">
              <div class="t-avatar">${p.avatar}</div>
              <div class="t-name">${escapeHtml(p.name)}${p.id===State.playerId?' (Kamu)':''}</div>
            </div>`).join('')}
          </div>
          <button class="action-btn btn-heal" onclick="Game.doDoctor()">💊 Sembuhkan</button>
        `;
        break;

      case 'guard':
        if((State.players[State.playerId]?.skillCooldown||0) > 0) {
          panel.innerHTML = `<div class="action-status fail">⏳ Skill cooldown. Tunggu ${State.players[State.playerId].skillCooldown} malam.</div>`;
          State.actionDone = true;
        } else {
          panel.innerHTML = `
            <p style="margin-bottom:0.5rem;color:var(--text-dim)">🛡️ Lindungi seorang pemain (80% berhasil):</p>
            <div class="action-target-grid">${alive.map(p => `
              <div class="action-target ${State.selectedTarget===p.id?'selected':''}" onclick="Game.selectTarget('${p.id}')">
                <div class="t-avatar">${p.avatar}</div>
                <div class="t-name">${escapeHtml(p.name)}</div>
              </div>`).join('')}
            </div>
            <button class="action-btn btn-guard" onclick="Game.doGuard()">🛡️ Lindungi</button>
          `;
        }
        break;

      case 'witch': {
        const usedHeal = State.witchHealUsed;
        const usedPoison = State.witchPoisonUsed;
        panel.innerHTML = `
          <p style="margin-bottom:0.5rem;color:var(--text-dim)">🧙 Ramuan Kamu:</p>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.75rem">
            <span style="color:${usedHeal?'var(--text-dim)':'#50e090'}">💚 Ramuan Hidup: ${usedHeal?'Sudah dipakai':'Tersedia'}</span>
            <span style="color:${usedPoison?'var(--text-dim)':'var(--purple)'}">💜 Ramuan Mati: ${usedPoison?'Sudah dipakai':'Tersedia'}</span>
          </div>
          ${!usedHeal ? `
            <p style="font-size:0.85rem;color:var(--text-dim)">Pilih target untuk diselamatkan:</p>
            <div class="action-target-grid">${aliveAll.map(p=>`
              <div class="action-target ${State.selectedTarget===p.id?'selected':''}" onclick="Game.selectTarget('${p.id}')">
                <div class="t-avatar">${p.avatar}</div>
                <div class="t-name">${escapeHtml(p.name)}</div>
              </div>`).join('')}
            </div>
            <button class="action-btn btn-heal" onclick="Game.doWitchHeal()">💚 Pakai Ramuan Hidup</button>
          ` : ''}
          ${!usedPoison ? `
            <p style="font-size:0.85rem;color:var(--text-dim);margin-top:0.5rem">Pilih target untuk diracuni:</p>
            <div class="action-target-grid">${alive.map(p=>`
              <div class="action-target ${State.selectedTarget===p.id?'selected':''}" onclick="Game.selectTarget('${p.id}')">
                <div class="t-avatar">${p.avatar}</div>
                <div class="t-name">${escapeHtml(p.name)}</div>
              </div>`).join('')}
            </div>
            <button class="action-btn btn-poison" onclick="Game.doWitchPoison()">💜 Pakai Ramuan Mati</button>
          ` : ''}
          ${(usedHeal && usedPoison) ? `<div class="action-status">Semua ramuan sudah habis. Tunggu pagi...</div>` : ''}
          <button class="action-btn" onclick="Game.skipAction()">⏭️ Lewati</button>
        `;
        break;
      }

      case 'werewolf':
      case 'doppleganger': {
        const isDopple = role === 'doppleganger';
        const wolfTeammates = Object.values(players).filter(p => p.alive && p.team === 'red' && p.id !== State.playerId);
        panel.innerHTML = `
          <p style="margin-bottom:0.5rem;color:var(--red)">🐺 Tim Serigala:</p>
          <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;flex-wrap:wrap">
            ${wolfTeammates.map(p=>`<span style="background:rgba(255,74,74,0.15);border:1px solid rgba(255,74,74,0.3);padding:0.2rem 0.6rem;border-radius:6px;font-size:0.85rem">${p.avatar} ${escapeHtml(p.name)}</span>`).join('') || '<span style="color:var(--text-dim);font-size:0.85rem">Kamu sendirian...</span>'}
          </div>
          <p style="margin-bottom:0.5rem;color:var(--text-dim)">${isDopple ? '👤 Salin role pemain:' : '🐺 Pilih korban:'}</p>
          <div class="action-target-grid">${alive.map(p=>`
            <div class="action-target ${State.selectedTarget===p.id?'selected':''}" onclick="Game.selectTarget('${p.id}')">
              <div class="t-avatar">${p.avatar}</div>
              <div class="t-name">${escapeHtml(p.name)}</div>
            </div>`).join('')}
          </div>
          <button class="action-btn btn-kill" onclick="${isDopple ? 'Game.doDoppleganger()' : 'Game.doWerewolf()'}">
            ${isDopple ? '👤 Salin Role' : '🐺 Serang!'}
          </button>
          <button class="action-btn" onclick="Game.skipAction()">⏭️ Lewati</button>
        `;
        break;
      }

      case 'vampire': {
        const dayNum = room.day || 1;
        const eclipse = event === 'eclipse';
        const vampireActive = (dayNum % 2 === 0) || eclipse;
        if(!vampireActive) {
          panel.innerHTML = `<div class="action-status fail">🧛 Vampire tidak aktif malam ganjil. Tunggu malam genap.</div>`;
          State.actionDone = true;
        } else {
          panel.innerHTML = `
            ${eclipse ? '<div class="action-status" style="color:var(--yellow)">🌑 Gerhana! Vampire aktif malam ini!</div>' : ''}
            <p style="margin-bottom:0.5rem;color:var(--purple)">🧛 Pilih korban vampire:</p>
            <div class="action-target-grid">${alive.map(p=>`
              <div class="action-target ${State.selectedTarget===p.id?'selected':''}" onclick="Game.selectTarget('${p.id}')">
                <div class="t-avatar">${p.avatar}</div>
                <div class="t-name">${escapeHtml(p.name)}</div>
              </div>`).join('')}
            </div>
            <button class="action-btn" style="color:var(--purple);border-color:var(--purple)" onclick="Game.doVampire()">🧛 Serang!</button>
            <button class="action-btn" onclick="Game.skipAction()">⏭️ Lewati</button>
          `;
        }
        break;
      }

      default:
        panel.innerHTML = `<div class="action-status">Menunggu aksi malam selesai...</div>`;
        State.actionDone = true;
    }
  },

  renderDeathAnnouncement(deathMessages, players) {
    const el = document.getElementById('deathAnnouncement');
    const list = document.getElementById('deathList');
    if(!deathMessages || deathMessages.length === 0) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    list.innerHTML = deathMessages.map(d => {
      const p = players[d.playerId];
      if(!p) return '';
      return `
        <div class="death-item">
          <span style="font-size:1.5rem">${p.avatar}</span>
          <div>
            <strong>${escapeHtml(p.name)}</strong> telah mati
            <div style="font-size:0.8rem;color:var(--text-dim)">${d.cause}</div>
          </div>
          <span style="margin-left:auto;font-size:0.8rem;padding:0.2rem 0.5rem;border-radius:4px;background:rgba(${d.teamColor||'255,74,74'},0.2)">
            ${ROLES[p.role]?.icon || '?'} ${ROLES[p.role]?.name || p.role}
          </span>
        </div>
      `;
    }).join('');
  },

  startTimer(seconds, onTick, onEnd) {
    State._timerSeconds = seconds;
    if(State._timerInterval) clearInterval(State._timerInterval);

    const updateDisplay = () => {
      const m = Math.floor(State._timerSeconds / 60).toString().padStart(2,'0');
      const s = (State._timerSeconds % 60).toString().padStart(2,'0');
      const el = document.getElementById('discussionTimer');
      if(el) el.textContent = `${m}:${s}`;
      const fill = document.getElementById('timerFill');
      if(fill) fill.style.width = `${(State._timerSeconds / seconds) * 100}%`;
      if(onTick) onTick(State._timerSeconds);
    };

    updateDisplay();
    State._timerInterval = setInterval(() => {
      State._timerSeconds--;
      updateDisplay();
      if(State._timerSeconds <= 0) {
        clearInterval(State._timerInterval);
        if(onEnd) onEnd();
      }
    }, 1000);
  },

  /** Generate bintang malam */
  generateStars() {
    const c = document.getElementById('starsContainer');
    if(!c) return;
    c.innerHTML = '';
    for(let i = 0; i < 60; i++) {
      const s = document.createElement('div');
      s.className = 'star';
      const size = Math.random() * 3 + 1;
      s.style.cssText = `
        width:${size}px;height:${size}px;
        top:${Math.random()*100}%;
        left:${Math.random()*100}%;
        --dur:${2 + Math.random()*3}s;
        --delay:${Math.random()*3}s;
      `;
      c.appendChild(s);
    }
  },

  spawnWinParticles(team) {
    const c = document.getElementById('winParticles');
    if(!c) return;
    const colors = {
      blue: ['#4a9eff','#a0d4ff','#ffffff'],
      red:  ['#ff4a4a','#ff8080','#ffcc00'],
      purple:['#a855f7','#d4aaff','#ffffff'],
      yellow:['#fbbf24','#fff4b0','#ffffff']
    }[team] || ['#ffffff'];

    c.innerHTML = '';
    for(let i = 0; i < 80; i++) {
      const p = document.createElement('div');
      p.className = 'win-particle';
      const col = colors[Math.floor(Math.random()*colors.length)];
      p.style.cssText = `
        left:${Math.random()*100}%;
        background:${col};
        --dur:${1.5 + Math.random()*2}s;
        --delay:${Math.random()*2}s;
        width:${4+Math.random()*8}px;
        height:${4+Math.random()*8}px;
        border-radius:${Math.random()>0.5?'50%':'0'};
      `;
      c.appendChild(p);
    }
  }
};

/* ═══════════════════════════════════════════════════════════════
   E. ADMIN MODULE
═══════════════════════════════════════════════════════════════ */

const Admin = {
  // Hash sederhana (djb2) — password tidak disimpan plaintext di source
  _hashPw(str) {
    let h = 5381;
    for(let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
    return (h >>> 0).toString(16);
  },

  login() {
    const pw = document.getElementById('adminPasswordInput').value.trim();
    // Hash dari "my game" — ubah nilai ini jika ingin ganti password
    const ADMIN_HASH = '56ca48ff';
    if(this._hashPw(pw) === ADMIN_HASH) {
      State.isAdmin = true;
      UI.closeAdminLogin();
      UI.showScreen('adminScreen');
      UI.toast('Login admin berhasil!', 'success');
    } else {
      UI.toast('Password salah!', 'error');
    }
  },

  async createRoom() {
    if(!window._firebaseReady) { UI.toast('Firebase belum siap. Mode demo tidak bisa buat room.','warn'); return; }
    const maxPlayers = parseInt(document.getElementById('maxPlayersInput').value) || 8;
    const adminName  = document.getElementById('adminNameInput').value.trim() || 'Admin';
    if(maxPlayers < 6 || maxPlayers > 20) { UI.toast('Jumlah pemain harus 6-20','warn'); return; }

    const code = generateRoomCode();
    State.playerId = 'admin_' + code;
    State.playerName = adminName;
    State.roomCode = code;

    try {
      await DB.setRoom(code, {
        code,
        adminId: State.playerId,
        maxPlayers,
        status: 'waiting',
        day: 0,
        currentEvent: null,
        winner: null,
        nightActions: {},
        votes: {},
        deadThisNight: [],
        deathMessages: [],
        createdAt: DB.m.serverTimestamp()
      });

      // Tambah admin sebagai player
      await DB.setPlayer(code, State.playerId, {
        id: State.playerId,
        name: adminName,
        role: null,
        team: null,
        alive: true,
        avatar: '👑',
        hasActed: false,
        skillCooldown: 0,
        consecutiveSelfHeal: 0,
        witchHealUsed: false,
        witchPoisonUsed: false,
        lastKillTarget: null,
        isAdmin: true
      });

      document.getElementById('displayRoomCode').textContent = code;
      document.getElementById('adminRoomInfo').style.display = 'block';
      UI.toast(`Room ${code} dibuat!`, 'success');

      // Watch room & players
      this._watchAdminRoom(code);

    } catch(e) {
      console.error(e);
      UI.toast('Gagal buat room: ' + e.message, 'error');
    }
  },

  _watchAdminRoom(code) {
    if(State._roomUnsub) State._roomUnsub();
    if(State._playersUnsub) State._playersUnsub();

    State._roomUnsub = DB.watchRoom(code, room => {
      State.room = room;
      if(room.status !== 'waiting' && room.winner == null) {
        // Game sudah dimulai, pindah ke role reveal / game screen
        if(room.status === 'roleReveal') {
          UI.showScreen('roleRevealScreen');
        }
      }
    });

    State._playersUnsub = DB.watchPlayers(code, players => {
      State.players = players;
      UI.renderAdminPlayers(players);
    });
  },

  copyCode() {
    const code = document.getElementById('displayRoomCode').textContent;
    navigator.clipboard?.writeText(code).then(() => UI.toast('Kode disalin!','success'));
  },

  async startGame() {
    if(!window._firebaseReady) return;
    const code = State.roomCode;
    if(!code) return;

    const players = await DB.getAllPlayers(code);
    const room    = await DB.getRoom(code);
    const n = Object.keys(players).length;

    if(n < 6) { UI.toast('Minimal 6 pemain untuk mulai!','warn'); return; }

    // Distribusi role (tidak termasuk admin)
    const nonAdminPlayers = Object.values(players).filter(p => !p.isAdmin);
    const roles = getRoleDistribution(nonAdminPlayers.length);

    // Assign role
    const updates = [];
    nonAdminPlayers.forEach((p, i) => {
      const roleKey = roles[i] || 'villager';
      const roleDef = ROLES[roleKey];
      updates.push(DB.updatePlayer(code, p.id, {
        role: roleKey,
        team: roleDef.team,
        alive: true,
        hasActed: false,
        skillCooldown: 0,
        consecutiveSelfHeal: 0
      }));
    });

    await Promise.all(updates);
    await DB.updateRoom(code, { status: 'roleReveal', day: 1 });
    await DB.addMessage(code, { sender:'system', name:'System', text:'Game dimulai! Semua pemain sedang melihat role mereka...', type:'public' });

    UI.toast('Game dimulai! Role sedang dibagikan...', 'success');
    UI.showActionAnim('🃏', 1500);

    // Setelah beberapa detik, pindah ke malam pertama
    setTimeout(async () => {
      await DB.updateRoom(code, { status: 'night' });
    }, 8000);
  },

  async proceedToVoting() {
    if(!State.isAdmin) return;
    const code = State.roomCode;
    await DB.updateRoom(code, { status: 'voting', votes: {} });
    await DB.addMessage(code, { sender:'system', name:'System', text:'Fase voting dimulai! Pilih siapa yang dieliminasi.', type:'public' });
    if(State._timerInterval) clearInterval(State._timerInterval);
    UI.transition('🗳️ FASE VOTING', 2000);
  },

  async proceedToNight() {
    if(!State.isAdmin) return;
    const code = State.roomCode;
    const room = State.room;
    const players = State.players;

    // Hitung vote
    const votes = room.votes || {};
    const counts = {};
    Object.values(votes).forEach(t => { counts[t] = (counts[t]||0)+1; });
    let maxVotes = 0, eliminated = null;
    let tie = false;
    Object.entries(counts).forEach(([id, c]) => {
      if(c > maxVotes) { maxVotes = c; eliminated = id; tie = false; }
      else if(c === maxVotes) tie = true;
    });

    const nextDay = (room.day || 1) + 1;
    const nightActions = {};
    const deathMessages = [];

    // Reset hasActed
    const playerUpdates = Object.values(players).map(p =>
      DB.updatePlayer(code, p.id, { hasActed: false })
    );

    if(eliminated && !tie && maxVotes > 0) {
      const ep = players[eliminated];
      if(ep && ep.alive) {
        playerUpdates.push(DB.updatePlayer(code, eliminated, { alive: false }));
        deathMessages.push({ playerId: eliminated, cause: `Dieliminasi melalui voting (${maxVotes} suara)` });
        await DB.addMessage(code, {
          sender:'system', name:'System',
          text:`${ep.name} dieliminasi melalui voting!`,
          type:'public'
        });

        // Joker win check
        if(ep.role === 'joker') {
          await this._endGame('yellow', players);
          return;
        }
      }
    } else {
      await DB.addMessage(code, { sender:'system', name:'System', text:'Voting berakhir seri! Tidak ada yang dieliminasi.', type:'public' });
    }

    await Promise.all(playerUpdates);

    // Check win kondisi
    const updatedPlayers = await DB.getAllPlayers(code);
    const winner = checkWinCondition(updatedPlayers);
    if(winner) {
      await this._endGame(winner, updatedPlayers);
      return;
    }

    // Random event
    let newEvent = null;
    const r = Math.random();
    if(r < 0.15) newEvent = 'fog';
    else if(r < 0.22) newEvent = 'eclipse';

    await DB.updateRoom(code, {
      status: 'night',
      day: nextDay,
      nightActions: {},
      votes: {},
      deadThisNight: [],
      deathMessages,
      currentEvent: newEvent
    });

    if(newEvent) {
      const eventNames = { fog: '🌫️ Malam Berkabut!', eclipse: '🌑 Gerhana!' };
      await DB.addMessage(code, { sender:'system', name:'System', text:`Event: ${eventNames[newEvent]}`, type:'public' });
    }

    UI.transition('🌙 MALAM TIBA', 2500);
  },

  async proceedToDay() {
    if(!State.isAdmin) return;
    const code = State.roomCode;
    const room = await DB.getRoom(code);
    const players = await DB.getAllPlayers(code);

    // Proses semua night actions
    const results = await GameLogic.resolveNightActions(room, players);
    const deathMessages = results.deaths;

    // Terapkan kematian
    const killUpdates = results.killed.map(id =>
      DB.updatePlayer(code, id, { alive: false })
    );
    await Promise.all(killUpdates);

    // Cek hunter
    for(const id of results.killed) {
      const p = players[id];
      if(p?.role === 'hunter' && p.alive) {
        // Trigger hunter shot (admin beri kesempatan)
        UI.toast(`${p.name} (Pemburu) tertembak! Mereka bisa membalas tembak.`, 'warn', 5000);
      }
    }

    // Cooldown update
    await GameLogic.updateCooldowns(code, players);

    // Check win
    const updatedPlayers = await DB.getAllPlayers(code);
    const winner = checkWinCondition(updatedPlayers);
    if(winner) {
      await this._endGame(winner, updatedPlayers);
      return;
    }

    await DB.updateRoom(code, {
      status: 'day',
      deathMessages,
      deadThisNight: results.killed,
      nightActions: {}
    });

    if(deathMessages.length > 0) {
      const names = deathMessages.map(d => players[d.playerId]?.name || '?').join(', ');
      await DB.addMessage(code, { sender:'system', name:'System', text:`Malam tadi: ${names} ditemukan tewas.`, type:'public' });
    } else {
      await DB.addMessage(code, { sender:'system', name:'System', text:'Malam berlalu dengan tenang... Tidak ada korban.', type:'public' });
    }

    UI.transition('☀️ FAJAR MENYINGSING', 2500);
  },

  async _endGame(winner, players) {
    const code = State.roomCode;
    const teamNames = { blue:'Tim Biru', red:'Tim Merah', purple:'Tim Ungu', yellow:'Joker' };
    await DB.updateRoom(code, { status: 'ended', winner });
    await DB.addMessage(code, {
      sender:'system', name:'System',
      text:`${teamNames[winner]} menang!`,
      type:'public'
    });
  },

  async closeRoom() {
    if(!State.roomCode) return;
    if(!confirm('Yakin tutup room?')) return;
    try {
      await DB.updateRoom(State.roomCode, { status: 'closed' });
      State.reset();
      UI.showScreen('menuScreen');
      UI.toast('Room ditutup.', 'info');
    } catch(e) { UI.toast('Gagal tutup room: '+e.message,'error'); }
  }
};

/* ═══════════════════════════════════════════════════════════════
   F. GAME MODULE (Player Actions)
═══════════════════════════════════════════════════════════════ */

const Game = {
  async joinRoom() {
    if(!window._firebaseReady) { UI.toast('Firebase belum terhubung. Cek konfigurasi.','error'); return; }

    const name = document.getElementById('playerNameInput').value.trim();
    const code = document.getElementById('roomCodeInput').value.trim().toUpperCase();

    if(!name) { UI.toast('Masukkan nama kamu!','warn'); return; }
    if(!code || code.length !== 6) { UI.toast('Kode room harus 6 karakter!','warn'); return; }

    try {
      const room = await DB.getRoom(code);
      if(!room) { UI.toast('Room tidak ditemukan!','error'); return; }
      if(room.status !== 'waiting') { UI.toast('Game sudah dimulai atau room sudah tutup!','warn'); return; }

      const players = await DB.getAllPlayers(code);
      if(Object.keys(players).length >= room.maxPlayers) { UI.toast('Room sudah penuh!','warn'); return; }

      // Generate ID unik
      State.playerId = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
      State.playerName = name;
      State.roomCode = code;

      await DB.setPlayer(code, State.playerId, {
        id: State.playerId,
        name,
        role: null,
        team: null,
        alive: true,
        avatar: AVATARS[Math.floor(Math.random()*AVATARS.length)],
        hasActed: false,
        skillCooldown: 0,
        consecutiveSelfHeal: 0,
        witchHealUsed: false,
        witchPoisonUsed: false,
        lastKillTarget: null,
        isAdmin: false
      });

      await DB.addMessage(code, {
        sender: 'system', name: 'System',
        text: `${name} bergabung ke room.`, type: 'public'
      });

      this._watchGame(code);
      UI.showScreen('lobbyScreen');
      UI.toast(`Bergabung ke room ${code}!`, 'success');

    } catch(e) {
      console.error(e);
      UI.toast('Gagal bergabung: '+e.message,'error');
    }
  },

  _watchGame(code) {
    // Watch room state
    if(State._roomUnsub) State._roomUnsub();
    State._roomUnsub = DB.watchRoom(code, room => {
      const prevStatus = State.room?.status;
      State.room = room;

      if(room.status === 'waiting') {
        // stay in lobby
      } else if(room.status === 'roleReveal') {
        // Load my role
        const me = State.players[State.playerId];
        if(me?.role && !State.myRole) {
          State.myRole = me.role;
          State.myTeam = me.team;
          UI.setRoleCard(me.role);
          UI.showScreen('roleRevealScreen');
          UI.showActionAnim('🃏', 1500);
        }
      } else if(room.status === 'day') {
        if(prevStatus !== 'day') {
          UI.transition('☀️ FAJAR MENYINGSING', 2500).then(() => {
            this._enterDay(room);
          });
        } else {
          this._updateDay(room);
        }
      } else if(room.status === 'voting') {
        if(prevStatus !== 'voting') {
          UI.transition('🗳️ VOTING', 2000).then(() => {
            this._enterVoting(room);
          });
        } else {
          this._updateVoting(room);
        }
      } else if(room.status === 'night') {
        if(prevStatus !== 'night') {
          UI.transition('🌙 MALAM TIBA', 2500).then(() => {
            this._enterNight(room);
          });
        } else {
          this._updateNight(room);
        }
      } else if(room.status === 'ended') {
        this._enterWin(room);
      } else if(room.status === 'closed') {
        UI.toast('Room ditutup oleh admin.','warn');
        this.reset();
        UI.showScreen('menuScreen');
      }
    });

    // Watch players
    if(State._playersUnsub) State._playersUnsub();
    State._playersUnsub = DB.watchPlayers(code, players => {
      State.players = players;
      const me = players[State.playerId];
      if(me) {
        State.myRole = me.role || State.myRole;
        State.myTeam = me.team || State.myTeam;
        State.myAlive = me.alive;
        // Sync witch state dari Firestore (agar tidak hilang saat refresh)
        if(me.role === 'witch') {
          State.witchHealUsed   = me.witchHealUsed   || false;
          State.witchPoisonUsed = me.witchPoisonUsed || false;
        }
      }

      // Update current screen
      const room = State.room;
      if(!room) return;

      // Lobby
      UI.renderLobbyPlayers(players, room.maxPlayers);

      // Day
      if(room.status === 'day') UI.renderAlivePlayers(players);

      // Voting
      if(room.status === 'voting') UI.renderVoteCandidates(players);

      // Night panel
      if(room.status === 'night') UI.renderNightPanel(room, players);

      // Check if I died
      if(me && !me.alive && State.myAlive === false) {
        if(!['deadScreen','winScreen'].includes(this._currentScreen())) {
          this._enterDead(me);
        }
      }
    });

    // Watch public messages
    if(State._messagesUnsub) State._messagesUnsub();
    State._messagesUnsub = DB.watchMessages(code, 'public', msgs => {
      Chat.renderMessages(msgs, 'lobbyChatMessages');
      Chat.renderMessages(msgs, 'dayChatMessages');
    });

    // Watch wolf team messages
    if(State.myTeam === 'red') {
      State._wolfMsgUnsub = DB.watchMessages(code, 'wolf', msgs => {
        Chat.renderMessages(msgs, 'wolfChatMessages');
      });
    }

    // Watch dead messages
    State._deadMsgUnsub = DB.watchMessages(code, 'dead', msgs => {
      Chat.renderMessages(msgs, 'deadChatMessages');
    });
  },

  _currentScreen() {
    const active = document.querySelector('.screen.active');
    return active?.id || '';
  },

  _enterDay(room) {
    const me = State.players[State.playerId];
    if(me && !me.alive) { this._enterDead(me); return; }

    document.getElementById('dayNumber').textContent = room.day || 1;
    UI.showScreen('dayScreen');
    UI.renderAlivePlayers(State.players);
    UI.renderDeathAnnouncement(room.deathMessages, State.players);
    State.actionDone = false;

    // Event banner
    const eb = document.getElementById('dayEventBanner');
    if(room.currentEvent) {
      const eventNames = { fog: '🌫️ Semalam: Malam Berkabut', eclipse: '🌑 Semalam: Gerhana' };
      eb.textContent = eventNames[room.currentEvent] || '';
      eb.style.display = 'block';
    } else { eb.style.display = 'none'; }

    // Admin controls
    document.getElementById('proceedToVoteBtn').style.display = State.isAdmin ? 'block' : 'none';

    // Timer diskusi 2 menit
    UI.startTimer(120, null, () => {
      if(State.isAdmin) Admin.proceedToVoting();
    });
  },

  _updateDay(room) {
    UI.renderDeathAnnouncement(room.deathMessages, State.players);
  },

  _enterVoting(room) {
    const me = State.players[State.playerId];
    if(me && !me.alive) return;

    UI.showScreen('votingScreen');
    State.myVote = room.votes?.[State.playerId] || null;
    UI.renderVoteCandidates(State.players);
    document.getElementById('proceedToNightBtn').style.display = State.isAdmin ? 'block' : 'none';
  },

  _updateVoting(room) {
    State.myVote = room.votes?.[State.playerId] || null;
    UI.renderVoteCandidates(State.players);

    const voteStatus = document.getElementById('myVoteStatus');
    if(State.myVote) {
      const tp = State.players[State.myVote];
      voteStatus.textContent = `✅ Kamu memilih: ${tp?.name || '?'}`;
    } else {
      voteStatus.textContent = '⏳ Belum memberikan suara...';
    }
  },

  _enterNight(room) {
    const me = State.players[State.playerId];
    if(me && !me.alive) { this._enterDead(me); return; }

    document.getElementById('nightNumber').textContent = room.day || 1;
    State.actionDone = false;
    State.selectedTarget = null;

    UI.showScreen('nightScreen');
    UI.generateStars();
    UI.renderNightPanel(room, State.players);

    // Fog/eclipse overlay
    document.getElementById('fogOverlay').style.display = room.currentEvent==='fog' ? 'block':'none';
    document.getElementById('eclipseOverlay').style.display = room.currentEvent==='eclipse' ? 'block':'none';

    // Event banner
    const nb = document.getElementById('nightEventBanner');
    if(room.currentEvent) {
      nb.textContent = room.currentEvent==='fog' ? '🌫️ Malam Berkabut! Semua skill gagal.' : '🌑 Gerhana! Semua role aktif.';
      nb.style.display = 'block';
    } else { nb.style.display = 'none'; }

    // Wolf team chat
    if(State.myTeam === 'red') {
      document.getElementById('wolfTeamChat').style.display = 'block';
    }

    // Admin proceed button
    document.getElementById('proceedToDayBtn').style.display = State.isAdmin ? 'block' : 'none';
  },

  _updateNight(room) {
    const me = State.players[State.playerId];
    if(!me?.alive) return;
    UI.renderNightPanel(room, State.players);

    // Check if all non-admin players have acted
    const alive = Object.values(State.players).filter(p => p.alive && !p.isAdmin && ROLES[p.role]?.hasPower);
    const allActed = alive.every(p => p.hasActed || p.skillCooldown > 0 || !ROLES[p.role]?.hasPower);
    if(allActed && State.isAdmin) {
      // Auto proceed after 2s
      setTimeout(() => {
        if(State.room?.status === 'night') Admin.proceedToDay();
      }, 2000);
    }
  },

  _enterDead(me) {
    document.getElementById('deadRoleReveal').textContent = `Role kamu: ${ROLES[me.role]?.icon || '?'} ${ROLES[me.role]?.name || me.role}`;
    UI.showScreen('deadScreen');
    UI.showActionAnim('💀', 1500);
  },

  _enterWin(room) {
    const team = room.winner;
    const teamNames = { blue:'TIM BIRU MENANG! 🎉', red:'TIM MERAH MENANG! 🐺', purple:'VAMPIRE MENANG! 🧛', yellow:'JOKER MENANG! 🃏' };
    const teamSubs  = { blue:'Desa berhasil diselamatkan!', red:'Serigala menguasai desa!', purple:'Semua darah terhisap!', yellow:'Joker berhasil memancing kematiannya!' };

    document.getElementById('winBg').className = `win-bg win-${team}`;
    document.getElementById('winTitle').textContent = teamNames[team] || 'GAME OVER';
    document.getElementById('winTitle').className = `win-title win-${team}`;
    document.getElementById('winSub').textContent = teamSubs[team] || '';
    document.getElementById('winIcon').textContent = { blue:'🏆', red:'🐺', purple:'🧛', yellow:'🃏' }[team] || '🏆';

    const winners = Object.values(State.players).filter(p => p.team === team || (room.winner === 'yellow' && p.role === 'joker'));
    document.getElementById('winnersList').innerHTML = winners.map(p =>
      `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem">
        <span style="font-size:1.5rem">${p.avatar}</span>
        <span>${escapeHtml(p.name)}</span>
        <span style="margin-left:auto;font-size:0.85rem;color:var(--text-dim)">${ROLES[p.role]?.icon} ${ROLES[p.role]?.name}</span>
      </div>`
    ).join('');

    UI.showScreen('winScreen');
    UI.spawnWinParticles(team);
  },

  async castVote(targetId) {
    if(!State.myAlive) return;
    if(!State.roomCode) return;
    const code = State.roomCode;
    const updates = {};
    updates[`votes.${State.playerId}`] = targetId;
    await DB.updateRoom(code, updates);
    UI.showActionAnim('🗳️', 800);
    UI.toast('Suara diberikan!', 'success');
  },

  selectTarget(id) {
    State.selectedTarget = id;
    // Re-render panel
    UI.renderNightPanel(State.room, State.players);
  },

  async _submitAction(actionType, targetId, extraData={}) {
    const code = State.roomCode;
    const updates = {};
    updates[`nightActions.${State.playerId}`] = { action: actionType, target: targetId, ...extraData };
    await DB.updateRoom(code, updates);
    await DB.updatePlayer(code, State.playerId, { hasActed: true });
    State.actionDone = true;
    document.getElementById('actionStatus').textContent = '✅ Aksi dilakukan. Menunggu pemain lain...';
    document.getElementById('actionStatus').className = 'action-status success';
  },

  async skipAction() {
    await this._submitAction('skip', null);
    UI.toast('Aksi dilewati.', 'info');
  },

  async doSeer() {
    if(!State.selectedTarget) { UI.toast('Pilih target terlebih dahulu!','warn'); return; }
    const target = State.players[State.selectedTarget];
    if(!target) return;

    // 20% kemungkinan salah
    let revealedTeam = target.team;
    if(Math.random() < 0.2) {
      const allTeams = ['blue','red','purple','yellow'];
      revealedTeam = allTeams[Math.floor(Math.random()*allTeams.length)];
    }

    await this._submitAction('seer', State.selectedTarget);
    await DB.updatePlayer(State.roomCode, State.playerId, { skillCooldown: 1 });
    UI.showActionAnim('🔮', 1200);
    UI.toast(`Hasil ramalan: ${target.name} terlihat sebagai Tim ${revealedTeam.toUpperCase()}`, 'info', 5000);
  },

  async doDoctor() {
    if(!State.selectedTarget) { UI.toast('Pilih target!','warn'); return; }
    const me = State.players[State.playerId];

    // Cek self-heal berturut
    if(State.selectedTarget === State.playerId) {
      if((me?.consecutiveSelfHeal||0) >= 1) {
        UI.toast('Tidak bisa sembuhkan diri sendiri 2x berturut!','warn'); return;
      }
      await DB.updatePlayer(State.roomCode, State.playerId, { consecutiveSelfHeal: (me?.consecutiveSelfHeal||0)+1 });
    } else {
      await DB.updatePlayer(State.roomCode, State.playerId, { consecutiveSelfHeal: 0 });
    }

    await this._submitAction('heal', State.selectedTarget);
    UI.showActionAnim('💊', 1200);
    UI.toast('Pemain akan disembuhkan!', 'success');
  },

  async doGuard() {
    if(!State.selectedTarget) { UI.toast('Pilih target!','warn'); return; }
    await this._submitAction('guard', State.selectedTarget);
    await DB.updatePlayer(State.roomCode, State.playerId, { skillCooldown: 2 });
    UI.showActionAnim('🛡️', 1200);
    UI.toast('Pemain dilindungi (80% berhasil)!', 'success');
  },

  async doWitchHeal() {
    if(!State.selectedTarget) { UI.toast('Pilih target!','warn'); return; }
    if(State.witchHealUsed) { UI.toast('Ramuan hidup sudah habis!','warn'); return; }
    State.witchHealUsed = true;
    // Simpan ke Firestore agar tidak reset saat refresh
    await DB.updatePlayer(State.roomCode, State.playerId, { witchHealUsed: true });
    await this._submitAction('witchHeal', State.selectedTarget);
    UI.showActionAnim('💚', 1200);
    UI.toast('Ramuan hidup digunakan!', 'success');
  },

  async doWitchPoison() {
    if(!State.selectedTarget) { UI.toast('Pilih target!','warn'); return; }
    if(State.witchPoisonUsed) { UI.toast('Ramuan mati sudah habis!','warn'); return; }
    State.witchPoisonUsed = true;
    // Simpan ke Firestore agar tidak reset saat refresh
    await DB.updatePlayer(State.roomCode, State.playerId, { witchPoisonUsed: true });
    await this._submitAction('witchPoison', State.selectedTarget);
    UI.showActionAnim('💜', 1200);
    UI.toast('Ramuan mati digunakan!', 'success');
  },

  async doWerewolf() {
    if(!State.selectedTarget) { UI.toast('Pilih korban!','warn'); return; }
    // Cek tidak bunuh target yang sama 2 malam berturut (baca dari player data)
    const me = State.players[State.playerId];
    if(me?.lastKillTarget === State.selectedTarget) {
      UI.toast('Tidak bisa bunuh target yang sama 2 malam berturut!','warn'); return;
    }
    // Werewolf tidak bisa bunuh vampire
    const target = State.players[State.selectedTarget];
    if(target?.role === 'vampire') { UI.toast('Serigala tidak bisa menyerang vampire!','warn'); return; }

    // Simpan lastKillTarget ke player doc agar persisten
    await DB.updatePlayer(State.roomCode, State.playerId, { lastKillTarget: State.selectedTarget });
    await this._submitAction('kill', State.selectedTarget);
    UI.showActionAnim('🐺', 1500);
    UI.toast('Serangan dikirim!', 'success');
  },

  async doDoppleganger() {
    if(!State.selectedTarget) { UI.toast('Pilih target!','warn'); return; }
    const target = State.players[State.selectedTarget];
    if(!target) return;

    // Validasi target punya role yang valid (bukan admin/null)
    if(!target.role || !ROLES[target.role]) {
      UI.toast('Target tidak memiliki role yang valid!','warn'); return;
    }

    // Salin role
    const newRole = target.role;
    const newTeam = target.team;
    State.myRole = newRole;
    State.myTeam = newTeam;

    await DB.updatePlayer(State.roomCode, State.playerId, { role: newRole, team: newTeam });
    await this._submitAction('dopple', State.selectedTarget);
    UI.showActionAnim('👤', 1500);
    UI.toast(`Kamu menyalin role ${ROLES[newRole]?.name}! Tim kamu sekarang ${newTeam}.`, 'success', 5000);
  },

  async doVampire() {
    if(!State.selectedTarget) { UI.toast('Pilih korban!','warn'); return; }
    await this._submitAction('vampKill', State.selectedTarget);
    UI.showActionAnim('🧛', 1500);
    UI.toast('Serangan vampire dikirim!', 'success');
  },

  reset() {
    State.reset();
    Particles.init();
  }
};

/* ═══════════════════════════════════════════════════════════════
   G. GAME LOGIC (Server-side logic via Admin)
═══════════════════════════════════════════════════════════════ */

const GameLogic = {
  async resolveNightActions(room, players) {
    const actions = room.nightActions || {};
    const event = room.currentEvent;
    const healed = new Set();
    const guarded = new Set();
    const killed = new Set();
    const deaths = [];

    if(event === 'fog') {
      // Semua skill gagal
      return { killed: [], deaths: [] };
    }

    // 1. Heal (doctor & witch heal)
    Object.values(actions).forEach(a => {
      if(a.action === 'heal' || a.action === 'witchHeal') healed.add(a.target);
    });

    // 2. Guard (80% berhasil)
    Object.values(actions).forEach(a => {
      if(a.action === 'guard' && Math.random() < 0.8) guarded.add(a.target);
    });

    // 3. Witch poison
    Object.values(actions).forEach(a => {
      if(a.action === 'witchPoison') {
        const t = players[a.target];
        if(t?.alive && !healed.has(a.target) && !guarded.has(a.target)) {
          killed.add(a.target);
          deaths.push({ playerId: a.target, cause: 'Diracuni penyihir' });
        }
      }
    });

    // 4. Werewolf kill
    Object.values(actions).forEach(a => {
      if(a.action === 'kill') {
        const actorId = Object.keys(room.nightActions).find(k => room.nightActions[k] === a);
        const actor = actorId ? players[actorId] : null;
        const t = players[a.target];
        if(!t?.alive) return;
        if(healed.has(a.target) || guarded.has(a.target)) return;
        // Werewolf tidak bisa bunuh vampire
        if(t.role === 'vampire') return;
        killed.add(a.target);
        deaths.push({ playerId: a.target, cause: 'Dimangsa serigala 🐺' });
      }
    });

    // 5. Vampire kill
    const dayNum = room.day || 1;
    if(dayNum % 2 === 0 || event === 'eclipse') {
      Object.values(actions).forEach(a => {
        if(a.action === 'vampKill') {
          const t = players[a.target];
          if(!t?.alive) return;
          if(healed.has(a.target) || guarded.has(a.target)) return;
          killed.add(a.target);
          deaths.push({ playerId: a.target, cause: 'Diserang vampire 🧛' });
        }
      });
    }

    return { killed: [...killed], deaths };
  },

  async updateCooldowns(code, players) {
    const updates = Object.values(players).map(p => {
      if((p.skillCooldown||0) > 0) {
        return DB.updatePlayer(code, p.id, { skillCooldown: p.skillCooldown - 1 });
      }
      return Promise.resolve();
    });
    await Promise.all(updates);
  }
};

/* ═══════════════════════════════════════════════════════════════
   H. WIN CONDITION CHECK
═══════════════════════════════════════════════════════════════ */

function checkWinCondition(players) {
  const alive = Object.values(players).filter(p => p.alive);
  const blue   = alive.filter(p => p.team === 'blue');
  const red    = alive.filter(p => p.team === 'red');
  const purple = alive.filter(p => p.team === 'purple');
  const yellow = alive.filter(p => p.team === 'yellow');

  const allMonstersGone = red.length === 0 && purple.length === 0;

  // Tim Biru menang jika semua musuh mati
  if(allMonstersGone && blue.length > 0) return 'blue';

  // Tim Merah menang jika sama atau lebih dari sisa dan biru + ungu habis
  if(red.length >= blue.length + purple.length && blue.length + purple.length <= 0 && red.length > 0) return 'red';
  if(red.length >= alive.length / 2 && blue.length === 0 && purple.length === 0) return 'red';

  // Tim Ungu menang jika semua lain mati
  if(purple.length > 0 && blue.length === 0 && red.length === 0 && yellow.length === 0) return 'purple';

  // Tidak ada pemenang
  return null;
}

/* ═══════════════════════════════════════════════════════════════
   I. CHAT MODULE
═══════════════════════════════════════════════════════════════ */

const Chat = {
  renderMessages(msgs, containerId) {
    const el = document.getElementById(containerId);
    if(!el) return;
    el.innerHTML = msgs.map(m => {
      const isSystem = m.type === 'system' || m.sender === 'system';
      const isWolf   = m.type === 'wolf';
      const isDead   = m.type === 'dead';
      return `<div class="chat-msg ${isSystem?'system-msg':''} ${isWolf?'wolf-msg':''} ${isDead?'dead-msg':''}">
        ${isSystem ? '' : `<span class="msg-name">${escapeHtml(m.name||'?')}</span>`}
        ${escapeHtml(m.text||'')}
      </div>`;
    }).join('');
    el.scrollTop = el.scrollHeight;
  },

  async _send(inputId, type) {
    const inp = document.getElementById(inputId);
    if(!inp || !inp.value.trim()) return;
    const text = inp.value.trim();
    inp.value = '';

    if(!State.roomCode) return;

    await DB.addMessage(State.roomCode, {
      sender: State.playerId,
      name: State.playerName,
      text,
      type
    });
  },

  sendLobbyMessage() { this._send('lobbyChatInput','public'); },
  sendDayMessage()   { this._send('dayChatInput','public'); },
  sendWolfMessage()  { this._send('wolfChatInput','wolf'); },
  sendDeadMessage()  { this._send('deadChatInput','dead'); }
};

// Enter key pada chat inputs
document.addEventListener('DOMContentLoaded', () => {
  const chatMap = {
    'lobbyChatInput': () => Chat.sendLobbyMessage(),
    'dayChatInput':   () => Chat.sendDayMessage(),
    'wolfChatInput':  () => Chat.sendWolfMessage(),
    'deadChatInput':  () => Chat.sendDeadMessage()
  };
  Object.entries(chatMap).forEach(([id, fn]) => {
    const el = document.getElementById(id);
    if(el) el.addEventListener('keydown', e => { if(e.key==='Enter') fn(); });
  });
});

/* ═══════════════════════════════════════════════════════════════
   J. VOICE MODULE (WebRTC simplified via signaling)
═══════════════════════════════════════════════════════════════ */

const Voice = {
  _stream: null,
  _active: false,

  async toggleMic() {
    if(!this._active) {
      try {
        this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this._active = true;
        document.getElementById('micBtn').classList.add('active');
        document.getElementById('micStatus').textContent = 'ON';
        document.getElementById('micStatus').style.color = '#50e090';
        UI.toast('Mikrofon aktif! (Voice lokal — integrasikan WebRTC untuk multiplayer)', 'success');
      } catch(e) {
        UI.toast('Tidak bisa akses mikrofon: '+e.message, 'error');
      }
    } else {
      this._stream?.getTracks().forEach(t => t.stop());
      this._stream = null;
      this._active = false;
      document.getElementById('micBtn').classList.remove('active');
      document.getElementById('micStatus').textContent = 'OFF';
      document.getElementById('micStatus').style.color = '';
      UI.toast('Mikrofon dimatikan.', 'info');
    }
  }
};

/* ═══════════════════════════════════════════════════════════════
   K. PARTICLE BACKGROUND
═══════════════════════════════════════════════════════════════ */

const Particles = {
  canvas: null,
  ctx: null,
  particles: [],
  _raf: null,

  init() {
    this.canvas = document.getElementById('particleCanvas');
    if(!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    this.particles = Array.from({length: 40}, () => this.createParticle());
    if(this._raf) cancelAnimationFrame(this._raf);
    this.loop();
    window.addEventListener('resize', () => this.resize());
  },

  createParticle() {
    return {
      x: Math.random() * (this.canvas?.width||800),
      y: Math.random() * (this.canvas?.height||600),
      r: Math.random() * 2 + 0.5,
      vx: (Math.random()-0.5) * 0.3,
      vy: (Math.random()-0.5) * 0.3,
      opacity: Math.random() * 0.4 + 0.1,
      color: ['#4a9eff','#a855f7','#d4a843','#ffffff'][Math.floor(Math.random()*4)]
    };
  },

  resize() {
    if(!this.canvas) return;
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  },

  loop() {
    if(!this.ctx || !this.canvas) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if(p.x < 0) p.x = this.canvas.width;
      if(p.x > this.canvas.width) p.x = 0;
      if(p.y < 0) p.y = this.canvas.height;
      if(p.y > this.canvas.height) p.y = 0;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      this.ctx.fillStyle = p.color;
      this.ctx.globalAlpha = p.opacity;
      this.ctx.fill();
    });
    this.ctx.globalAlpha = 1;
    this._raf = requestAnimationFrame(() => this.loop());
  }
};

/* ═══════════════════════════════════════════════════════════════
   L. FIREBASE CONFIG OVERLAY (live config)
═══════════════════════════════════════════════════════════════ */

const FirebaseConfig = {
  apply() {
    const ak = document.getElementById('cfgApiKey').value.trim();
    const pi = document.getElementById('cfgProjectId').value.trim();
    const ai = document.getElementById('cfgAppId').value.trim();
    if(ak && pi && ai) {
      localStorage.setItem('ww_fb_config', JSON.stringify({ apiKey:ak, projectId:pi, appId:ai }));
      UI.toast('Config disimpan. Muat ulang halaman...','success');
      setTimeout(() => location.reload(), 1500);
    } else {
      UI.toast('Isi semua field!','warn');
    }
  }
};

/* ═══════════════════════════════════════════════════════════════
   M. UTILITIES
═══════════════════════════════════════════════════════════════ */

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:6}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
}

function shuffleArray(arr) {
  const a = [...arr];
  for(let i = a.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

function escapeHtml(str) {
  if(!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ═══════════════════════════════════════════════════════════════
   N. INIT
═══════════════════════════════════════════════════════════════ */

(function init() {
  // Loading screen
  setTimeout(() => {
    document.getElementById('loadingScreen').classList.remove('active');
    document.getElementById('menuScreen').classList.add('active');
  }, 2500);

  // Particles
  Particles.init();

  // Firebase ready check
  if(window._firebaseReady) {
    document.getElementById('firebaseConfigOverlay').style.display = 'none';
  } else {
    document.addEventListener('firebaseReady', () => {
      document.getElementById('firebaseConfigOverlay').style.display = 'none';
    }, { once: true });
  }

  console.log('%c🐺 WEREWOLF ONLINE v2.0', 'color:#d4a843;font-size:1.5rem;font-weight:bold;font-family:serif');
  console.log('%cDark Forest Multiplayer', 'color:#8a8090;font-size:0.9rem');
  console.log('%cFirebase: Ganti config di index.html', 'color:#4a9eff;font-size:0.8rem');
})();