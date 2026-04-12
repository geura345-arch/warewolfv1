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
    desc: '[BUFF] Hasil ramalan 100% akurat — tim target selalu terungkap dengan benar. Cooldown 1 malam.',
    hasPower: true,
    cooldown: 1
  },
  doctor: {
    name: 'Dokter',
    team: 'blue',
    icon: '💊',
    desc: '[NERF] Dapat menyembuhkan 1 pemain/malam. Tidak bisa menyembuhkan diri sendiri sama sekali.',
    hasPower: true,
    cooldown: 0
  },
  guard: {
    name: 'Penjaga',
    team: 'blue',
    icon: '🛡️',
    desc: '[BUFF] Proteksi 1 pemain — 100% berhasil. Cooldown 2 malam.',
    hasPower: true,
    cooldown: 2
  },
  witch: {
    name: 'Penyihir',
    team: 'blue',
    icon: '🧙',
    desc: '[NERF] Hanya punya 1 ramuan racun (sekali pakai). Jika meracuni tim biru, penyihir akan MELEDAK dan tereliminasi!',
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
    desc: '[BUFF] Bunuh 1 pemain tim biru/malam dan curi skillnya (maks 3 skill). Skill tidak bisa dicuri dari tim ungu/kuning.',
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
  witchPoisonUsed: false,

  // Hunter state
  hunterShotPending: false,

  // Doppleganger — stolen blue skills list (maks 3)
  doppleTarget: null,
  doppleSkills: [],   // array of stolen role keys e.g. ['seer','doctor']

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
    this.witchPoisonUsed = false;
    this.hunterShotPending = false;
    this.doppleTarget = null;
    this.doppleSkills = [];
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

  /** Render vote candidates — uses data attributes, no inline onclick with raw IDs */
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
             data-player-id="${escapeHtml(p.id)}" data-vote-target="1" role="button" tabindex="0">
          ${vCount > 0 ? `<div class="vote-count-badge">${vCount}</div>` : ''}
          <span class="player-avatar">${p.avatar}</span>
          <div class="player-name">${escapeHtml(p.name)}</div>
          ${isMe ? '<div style="font-size:0.7rem;color:var(--text-dim)">(Kamu)</div>' : ''}
        </div>
      `;
    }).join('');

    // Event delegation — tidak ada inline onclick
    grid.onclick = (e) => {
      const el = e.target.closest('[data-vote-target]');
      if(!el) return;
      const tid = el.dataset.playerId;
      if(tid) Game.castVote(tid);
    };

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
    const teamColorMap = { blue:'#4a9eff', red:'#ff4a4a', purple:'#a855f7', yellow:'#fbbf24' };
    const bannerColor = teamColorMap[r.team] || '#4a9eff';
    myRoleBanner.style.background = `${bannerColor}22`;
    myRoleBanner.innerHTML = `<span>${r.icon}</span><strong>${escapeHtml(r.name)}</strong><span style="font-size:0.8rem;color:var(--text-dim)">${escapeHtml(r.desc)}</span>`;

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

    const alive    = Object.values(players).filter(p => p.alive && p.id !== State.playerId);
    const aliveAll = Object.values(players).filter(p => p.alive);

    // Helper: build target card HTML (data-target-id, no inline onclick)
    const targetCard = (p) => `
      <div class="action-target ${State.selectedTarget===p.id?'selected':''}"
           data-target-id="${escapeHtml(p.id)}" role="button" tabindex="0">
        <div class="t-avatar">${p.avatar}</div>
        <div class="t-name">${escapeHtml(p.name)}</div>
      </div>`;

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
            <p style="margin-bottom:0.5rem;color:var(--text-dim)">🔮 Lihat tim seorang pemain <span style="color:#a0e0ff;font-size:0.82rem">(100% akurat)</span>:</p>
            <div class="action-target-grid">${alive.map(targetCard).join('')}</div>
            <button class="action-btn btn-see" data-action="seer">🔮 Ramalkan</button>
          `;
        }
        break;

      case 'doctor':
        panel.innerHTML = `
          <p style="margin-bottom:0.5rem;color:var(--text-dim)">💊 Sembuhkan seorang pemain:</p>
          <div style="margin-bottom:0.5rem;padding:0.4rem 0.6rem;border-radius:6px;background:rgba(255,74,74,0.08);border:1px solid rgba(255,74,74,0.2);font-size:0.8rem;color:#ff8080">
            ⚠️ Dokter tidak bisa menyembuhkan diri sendiri.
          </div>
          <div class="action-target-grid">${alive.map(p => `
            <div class="action-target ${State.selectedTarget===p.id?'selected':''}"
                 data-target-id="${escapeHtml(p.id)}" role="button" tabindex="0">
              <div class="t-avatar">${p.avatar}</div>
              <div class="t-name">${escapeHtml(p.name)}</div>
            </div>`).join('')}
          </div>
          <button class="action-btn btn-heal" data-action="doctor">💊 Sembuhkan</button>
        `;
        break;

      case 'guard':
        if((State.players[State.playerId]?.skillCooldown||0) > 0) {
          panel.innerHTML = `<div class="action-status fail">⏳ Skill cooldown. Tunggu ${State.players[State.playerId].skillCooldown} malam.</div>`;
          State.actionDone = true;
        } else {
          panel.innerHTML = `
            <p style="margin-bottom:0.5rem;color:var(--text-dim)">🛡️ Lindungi seorang pemain <span style="color:#a0e0ff;font-size:0.82rem">(100% berhasil)</span>:</p>
            <div class="action-target-grid">${alive.map(targetCard).join('')}</div>
            <button class="action-btn btn-guard" data-action="guard">🛡️ Lindungi</button>
          `;
        }
        break;

      case 'witch': {
        const usedPoison = State.witchPoisonUsed;
        panel.innerHTML = `
          <p style="margin-bottom:0.5rem;color:var(--text-dim)">🧙 Ramuan Penyihir:</p>
          <div style="margin-bottom:0.75rem;padding:0.5rem;border-radius:8px;background:rgba(168,85,247,0.1);border:1px solid rgba(168,85,247,0.3)">
            <span style="color:${usedPoison?'var(--text-dim)':'var(--purple)'}">
              💜 Ramuan Racun: ${usedPoison ? 'Sudah dipakai' : 'Tersedia (sekali pakai)'}
            </span>
          </div>
          <div style="margin-bottom:0.75rem;padding:0.5rem;border-radius:8px;background:rgba(255,74,74,0.1);border:1px solid rgba(255,74,74,0.3);font-size:0.82rem;color:#ff8080">
            ⚠️ <strong>Peringatan:</strong> Jika meracuni tim biru, kamu akan MELEDAK dan tereliminasi!
          </div>
          ${!usedPoison ? `
            <p style="font-size:0.85rem;color:var(--text-dim)">Pilih target untuk diracuni:</p>
            <div class="action-target-grid">${alive.map(targetCard).join('')}</div>
            <button class="action-btn btn-poison" data-action="witchPoison">💜 Racuni Target</button>
          ` : `<div class="action-status fail">Ramuan sudah habis. Tunggu pagi...</div>`}
          <button class="action-btn" data-action="skip">⏭️ Lewati</button>
        `;
        break;
      }

      case 'werewolf':
      case 'doppleganger': {
        const isDopple = role === 'doppleganger';
        const wolfTeammates = Object.values(players).filter(p => p.alive && p.team === 'red' && p.id !== State.playerId);

        // Stolen skills display untuk doppleganger
        let doppleSkillsHtml = '';
        if(isDopple) {
          const stolen = State.doppleSkills || [];
          const SKILL_ICONS = { seer:'🔮', doctor:'💊', guard:'🛡️', witch:'🧙', hunter:'🏹' };
          doppleSkillsHtml = `
            <div style="margin-bottom:0.75rem;padding:0.5rem;border-radius:8px;background:rgba(255,74,74,0.08);border:1px solid rgba(255,74,74,0.25)">
              <div style="font-size:0.8rem;color:var(--text-dim);margin-bottom:0.3rem">🃏 Skill Tersimpan (${stolen.length}/3):</div>
              ${stolen.length > 0
                ? stolen.map(sk => `<span style="display:inline-block;margin:0.2rem;padding:0.15rem 0.5rem;border-radius:5px;background:rgba(74,158,255,0.15);border:1px solid rgba(74,158,255,0.3);font-size:0.82rem">${SKILL_ICONS[sk]||'❓'} ${ROLES[sk]?.name||sk}</span>`).join('')
                : '<span style="color:var(--text-dim);font-size:0.82rem">Belum ada skill dicuri</span>'}
            </div>
            <div style="margin-bottom:0.5rem;padding:0.4rem 0.6rem;border-radius:6px;background:rgba(255,200,0,0.08);border:1px solid rgba(255,200,0,0.2);font-size:0.8rem;color:#e0b840">
              ⚠️ Hanya bisa bunuh tim Biru. Berhasil bunuh = curi skill mereka.
            </div>
          `;
        }

        // Filter target: doppleganger hanya bisa target tim biru
        const validTargets = isDopple
          ? alive.filter(p => p.team === 'blue')
          : alive;

        panel.innerHTML = `
          <p style="margin-bottom:0.5rem;color:var(--red)">🐺 Tim Serigala:</p>
          <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;flex-wrap:wrap">
            ${wolfTeammates.map(p=>`<span style="background:rgba(255,74,74,0.15);border:1px solid rgba(255,74,74,0.3);padding:0.2rem 0.6rem;border-radius:6px;font-size:0.85rem">${p.avatar} ${escapeHtml(p.name)}</span>`).join('') || '<span style="color:var(--text-dim);font-size:0.85rem">Kamu sendirian...</span>'}
          </div>
          ${doppleSkillsHtml}
          <p style="margin-bottom:0.5rem;color:var(--text-dim)">${isDopple ? '👤 Serang & curi skill (tim biru saja):' : '🐺 Pilih korban:'}</p>
          ${validTargets.length === 0 && isDopple
            ? '<div class="action-status fail">Tidak ada target tim biru yang tersisa!</div>'
            : `<div class="action-target-grid">${validTargets.map(targetCard).join('')}</div>`
          }
          <button class="action-btn btn-kill" data-action="${isDopple ? 'dopple' : 'werewolf'}">
            ${isDopple ? '👤 Serang & Curi Skill!' : '🐺 Serang!'}
          </button>
          <button class="action-btn" data-action="skip">⏭️ Lewati</button>
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
            <div class="action-target-grid">${alive.map(targetCard).join('')}</div>
            <button class="action-btn" style="color:var(--purple);border-color:var(--purple)" data-action="vampire">🧛 Serang!</button>
            <button class="action-btn" data-action="skip">⏭️ Lewati</button>
          `;
        }
        break;
      }

      default:
        panel.innerHTML = `<div class="action-status">Menunggu aksi malam selesai...</div>`;
        State.actionDone = true;
    }

    // ── Event delegation untuk target selection dan action buttons ──
    panel.onclick = (e) => {
      // Target selection
      const targetEl = e.target.closest('[data-target-id]');
      if(targetEl) {
        Game.selectTarget(targetEl.dataset.targetId);
        return;
      }
      // Action buttons
      const btnEl = e.target.closest('[data-action]');
      if(!btnEl) return;
      const action = btnEl.dataset.action;
      switch(action) {
        case 'seer':       Game.doSeer();         break;
        case 'doctor':     Game.doDoctor();       break;
        case 'guard':      Game.doGuard();        break;
        case 'witchPoison':Game.doWitchPoison();  break;
        case 'werewolf':   Game.doWerewolf();     break;
        case 'dopple':     Game.doDoppleganger(); break;
        case 'vampire':    Game.doVampire();      break;
        case 'skip':       Game.skipAction();     break;
      }
    };
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
  // Hash SHA-256 async — tidak disimpan plaintext, tidak mudah di-brute-force via console
  async _hashPw(str) {
    const enc = new TextEncoder().encode(str + 'ww_salt_2025');
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  },

  // Brute-force guard: max 5 percobaan per sesi
  _loginAttempts: 0,
  _loginLocked: false,
  _loginLockTimer: null,

  async login() {
    if(this._loginLocked) {
      UI.toast('Terlalu banyak percobaan. Coba lagi setelah 30 detik.', 'error');
      return;
    }
    const pw = document.getElementById('adminPasswordInput').value;
    if(!pw || pw.length < 1) { UI.toast('Masukkan password!', 'warn'); return; }

    // Hash SHA-256 dari "werewolf2025admin" — ubah value ini untuk ganti password
    // Untuk generate hash baru: await crypto.subtle.digest('SHA-256', new TextEncoder().encode('PASSWORD_BARU'+'ww_salt_2025'))
    const ADMIN_HASH = '9d3a2f1b8e4c6078a5d2e9f1b3c7a041d8e2f5c9b1a4d7e0c3f6a2b8d5e1f4c9';
    // CATATAN: Hash di atas adalah placeholder. Generate hash password kamu sendiri.
    // Untuk produksi, simpan hash di Firebase Remote Config, bukan di source.

    const inputHash = await this._hashPw(pw);
    this._loginAttempts++;

    if(inputHash === ADMIN_HASH) {
      this._loginAttempts = 0;
      this._loginLocked = false;
      // Clear password input setelah login
      document.getElementById('adminPasswordInput').value = '';
      State.isAdmin = true;
      UI.closeAdminLogin();
      UI.showScreen('adminScreen');
      UI.toast('Login admin berhasil!', 'success');
    } else {
      if(this._loginAttempts >= 5) {
        this._loginLocked = true;
        UI.toast('Terlalu banyak percobaan! Dikunci 30 detik.', 'error');
        if(this._loginLockTimer) clearTimeout(this._loginLockTimer);
        this._loginLockTimer = setTimeout(() => {
          this._loginLocked = false;
          this._loginAttempts = 0;
        }, 30000);
      } else {
        UI.toast(`Password salah! (${5 - this._loginAttempts} percobaan tersisa)`, 'error');
      }
      document.getElementById('adminPasswordInput').value = '';
    }
  },

  async createRoom() {
    if(!window._firebaseReady) { UI.toast('Firebase belum siap. Mode demo tidak bisa buat room.','warn'); return; }
    const maxPlayersRaw = parseInt(document.getElementById('maxPlayersInput').value);
    const adminNameRaw  = document.getElementById('adminNameInput').value.trim();

    // Validasi input ketat
    if(isNaN(maxPlayersRaw) || maxPlayersRaw < 6 || maxPlayersRaw > 20) {
      UI.toast('Jumlah pemain harus antara 6–20','warn'); return;
    }
    if(!adminNameRaw || adminNameRaw.length < 2) {
      UI.toast('Nama admin minimal 2 karakter!','warn'); return;
    }
    if(adminNameRaw.length > 20) {
      UI.toast('Nama admin maksimal 20 karakter!','warn'); return;
    }

    const maxPlayers = maxPlayersRaw;
    const adminName  = adminNameRaw;

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
        witchPoisonUsed: false,
        doppleSkills: [],
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

    // BUFF Doppleganger: update stolen skills ke Firestore
    if(results.doppleKills && Object.keys(results.doppleKills).length > 0) {
      const doppleUpdates = [];
      for(const [doppleId, stolenRole] of Object.entries(results.doppleKills)) {
        const dopple = players[doppleId];
        if(!dopple) continue;
        const currentSkills = dopple.doppleSkills || [];
        if(currentSkills.length < 3 && !currentSkills.includes(stolenRole)) {
          const newSkills = [...currentSkills, stolenRole];
          doppleUpdates.push(DB.updatePlayer(code, doppleId, { doppleSkills: newSkills }));
          await DB.addMessage(code, {
            sender: 'system', name: 'System',
            text: `👤 Doppleganger mencuri skill ${ROLES[stolenRole]?.name || stolenRole}! (${newSkills.length}/3 skill)`,
            type: 'public'
          });
        }
      }
      await Promise.all(doppleUpdates);
    }

    // Cek hunter
    for(const id of results.killed) {
      const p = players[id];
      if(p?.role === 'hunter' && p.alive) {
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

    const rawName = document.getElementById('playerNameInput').value.trim();
    const rawCode = document.getElementById('roomCodeInput').value.trim().toUpperCase();

    // --- INPUT VALIDATION ---
    if(!rawName) { UI.toast('Masukkan nama kamu!','warn'); return; }
    if(rawName.length < 2) { UI.toast('Nama minimal 2 karakter!','warn'); return; }
    if(rawName.length > 20) { UI.toast('Nama maksimal 20 karakter!','warn'); return; }

    // Whitelist: hanya huruf, angka, spasi, dan beberapa karakter aman
    const nameRegex = /^[a-zA-Z0-9\u00C0-\u024F\u0020\u002D\u005F\u00B7\s]+$/;
    if(!nameRegex.test(rawName)) { UI.toast('Nama hanya boleh mengandung huruf, angka, spasi, dan tanda (-_).','warn'); return; }

    if(!rawCode || rawCode.length !== 6) { UI.toast('Kode room harus 6 karakter!','warn'); return; }
    // Room code: hanya huruf kapital dan angka (sesuai generateRoomCode)
    if(!/^[A-Z2-9]{6}$/.test(rawCode)) { UI.toast('Kode room tidak valid!','warn'); return; }

    const name = rawName;
    const code = rawCode;

    try {
      const room = await DB.getRoom(code);
      if(!room) { UI.toast('Room tidak ditemukan!','error'); return; }
      if(room.status !== 'waiting') { UI.toast('Game sudah dimulai atau room sudah tutup!','warn'); return; }

      const players = await DB.getAllPlayers(code);
      if(Object.keys(players).length >= room.maxPlayers) { UI.toast('Room sudah penuh!','warn'); return; }

      // Anti-spam: cek apakah nama sudah dipakai di room ini
      const nameTaken = Object.values(players).some(p => p.name.toLowerCase() === name.toLowerCase());
      if(nameTaken) { UI.toast('Nama ini sudah dipakai! Pilih nama lain.','warn'); return; }

      // Generate ID unik yang lebih kuat (tidak predictable)
      const randomPart = Array.from(crypto.getRandomValues(new Uint8Array(8)))
        .map(b => b.toString(16).padStart(2,'0')).join('');
      State.playerId = 'p_' + randomPart;
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
        witchPoisonUsed: false,
        doppleSkills: [],
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
        // Load my role — pastikan data player sudah tersedia
        const me = State.players[State.playerId];
        if(me?.role && !State.myRole) {
          State.myRole = me.role;
          State.myTeam = me.team;
          UI.setRoleCard(me.role);
          UI.showScreen('roleRevealScreen');
          UI.showActionAnim('🃏', 1500);
        } else if(!me?.role) {
          // Data player belum siap, tunggu watchPlayers callback untuk trigger ini
          // Tidak perlu action di sini, watchPlayers akan re-trigger
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
          State.witchPoisonUsed = me.witchPoisonUsed || false;
        }
        // Sync dopple skills dari Firestore
        if(me.role === 'doppleganger') {
          State.doppleSkills = me.doppleSkills || [];
        }

        // FIX: Handle roleReveal race condition — jika room sudah roleReveal tapi role baru tiba sekarang
        const room = State.room;
        if(room?.status === 'roleReveal' && me.role && !State.myRole) {
          State.myRole = me.role;
          State.myTeam = me.team;
          UI.setRoleCard(me.role);
          UI.showScreen('roleRevealScreen');
        }

        // FIX: Setup wolf chat listener ketika team diketahui
        if(me.team === 'red' && State.roomCode) {
          this._setupWolfChatIfNeeded(State.roomCode);
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

    // Watch wolf team messages — setup setelah role diketahui
    // Listener ini akan di-refresh saat myTeam diketahui (lihat watchPlayers callback)
    this._setupWolfChatIfNeeded(code);

    // Watch dead messages
    State._deadMsgUnsub = DB.watchMessages(code, 'dead', msgs => {
      Chat.renderMessages(msgs, 'deadChatMessages');
    });
  },

  // Dipanggil saat myTeam sudah diketahui (dari watchPlayers atau roleReveal)
  _setupWolfChatIfNeeded(code) {
    // Hanya setup wolf chat jika team adalah red DAN belum ada listener
    if(State.myTeam === 'red' && !State._wolfMsgUnsub) {
      State._wolfMsgUnsub = DB.watchMessages(code, 'wolf', msgs => {
        Chat.renderMessages(msgs, 'wolfChatMessages');
      });
    }
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
    if(!State.myAlive) { UI.toast('Pemain mati tidak bisa vote!','warn'); return; }
    if(!State.roomCode) return;
    if(State.room?.status !== 'voting') { UI.toast('Bukan fase voting!','warn'); return; }

    // Tidak boleh vote untuk diri sendiri
    if(targetId === State.playerId) { UI.toast('Tidak bisa memilih dirimu sendiri!','warn'); return; }

    // Validasi target masih hidup
    const target = State.players[targetId];
    if(!target || !target.alive) { UI.toast('Target tidak valid!','warn'); return; }

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
    // Guard: pemain mati tidak bisa submit aksi
    if(!State.myAlive) { UI.toast('Pemain mati tidak bisa bertindak!','warn'); return; }
    // Guard: bukan fase malam
    if(State.room?.status !== 'night') { UI.toast('Bukan fase malam!','warn'); return; }
    // Guard: sudah bertindak
    if(State.actionDone) { UI.toast('Kamu sudah bertindak malam ini!','warn'); return; }
    // Guard: validasi action type terhadap whitelist
    const ALLOWED_ACTIONS = ['skip','seer','heal','guard','witchPoison','kill','dopple','vampKill'];
    if(!ALLOWED_ACTIONS.includes(actionType)) { console.warn('Invalid action type blocked:', actionType); return; }
    // Guard: validasi target jika ada
    if(targetId && !State.players[targetId]) { UI.toast('Target tidak valid!','warn'); return; }

    const code = State.roomCode;
    const updates = {};
    updates[`nightActions.${State.playerId}`] = { action: actionType, target: targetId || null, ...extraData };
    await DB.updateRoom(code, updates);
    await DB.updatePlayer(code, State.playerId, { hasActed: true });
    State.actionDone = true;
    const statusEl = document.getElementById('actionStatus');
    if(statusEl) {
      statusEl.textContent = '✅ Aksi dilakukan. Menunggu pemain lain...';
      statusEl.className = 'action-status success';
    }
  },

  async skipAction() {
    await this._submitAction('skip', null);
    UI.toast('Aksi dilewati.', 'info');
  },

  async doSeer() {
    if(State.myRole !== 'seer') { console.warn('[Security] Role mismatch blocked'); return; }
    if(!State.selectedTarget) { UI.toast('Pilih target terlebih dahulu!','warn'); return; }
    const target = State.players[State.selectedTarget];
    if(!target) return;

    // BUFF: Hasil ramalan 100% akurat — tidak ada kemungkinan salah
    const revealedTeam = target.team;

    await this._submitAction('seer', State.selectedTarget);
    await DB.updatePlayer(State.roomCode, State.playerId, { skillCooldown: 1 });
    UI.showActionAnim('🔮', 1200);
    UI.toast(`🔮 Ramalan akurat: ${escapeHtml(target.name)} adalah Tim ${revealedTeam.toUpperCase()}`, 'info', 5000);
  },

  async doDoctor() {
    if(State.myRole !== 'doctor') { console.warn('[Security] Role mismatch blocked'); return; }
    if(!State.selectedTarget) { UI.toast('Pilih target!','warn'); return; }

    // NERF: Dokter tidak bisa menyembuhkan diri sendiri sama sekali
    if(State.selectedTarget === State.playerId) {
      UI.toast('Dokter tidak bisa menyembuhkan diri sendiri!','warn'); return;
    }

    // Reset consecutiveSelfHeal karena tidak relevan lagi, tapi tetap update untuk backward compat
    await DB.updatePlayer(State.roomCode, State.playerId, { consecutiveSelfHeal: 0 });

    await this._submitAction('heal', State.selectedTarget);
    UI.showActionAnim('💊', 1200);
    UI.toast('Pemain akan disembuhkan!', 'success');
  },

  async doGuard() {
    if(State.myRole !== 'guard') { console.warn('[Security] Role mismatch blocked'); return; }
    if(!State.selectedTarget) { UI.toast('Pilih target!','warn'); return; }
    await this._submitAction('guard', State.selectedTarget);
    await DB.updatePlayer(State.roomCode, State.playerId, { skillCooldown: 2 });
    UI.showActionAnim('🛡️', 1200);
    UI.toast('Pemain dilindungi dengan sempurna! (100% berhasil)', 'success');
  },

  // doWitchHeal dihapus — Penyihir tidak lagi punya ramuan hidup (NERF)

  async doWitchPoison() {
    if(State.myRole !== 'witch') { console.warn('[Security] Role mismatch blocked'); return; }
    if(!State.selectedTarget) { UI.toast('Pilih target!','warn'); return; }
    if(State.witchPoisonUsed) { UI.toast('Ramuan racun sudah habis!','warn'); return; }

    const target = State.players[State.selectedTarget];
    if(!target) { UI.toast('Target tidak valid!','warn'); return; }

    State.witchPoisonUsed = true;
    await DB.updatePlayer(State.roomCode, State.playerId, { witchPoisonUsed: true });
    await this._submitAction('witchPoison', State.selectedTarget);
    UI.showActionAnim('💜', 1200);

    // NERF: Jika target adalah tim biru, beri peringatan — ledakan diproses server-side di resolveNightActions
    if(target.team === 'blue') {
      UI.toast('⚠️ Kamu meracuni tim biru! Penyihir akan MELEDAK dan tereliminasi!', 'error', 5000);
    } else {
      UI.toast('Ramuan racun digunakan!', 'success');
    }
  },

  async doWerewolf() {
    if(State.myRole !== 'werewolf') { console.warn('[Security] Role mismatch blocked'); return; }
    if(!State.selectedTarget) { UI.toast('Pilih korban!','warn'); return; }
    // Cek tidak bunuh target yang sama 2 malam berturut (baca dari player data)
    const me = State.players[State.playerId];
    if(me?.lastKillTarget === State.selectedTarget) {
      UI.toast('Tidak bisa bunuh target yang sama 2 malam berturut!','warn'); return;
    }
    // Werewolf tidak bisa bunuh vampire
    const target = State.players[State.selectedTarget];
    if(target?.role === 'vampire') { UI.toast('Serigala tidak bisa menyerang vampire!','warn'); return; }
    // Werewolf tidak bisa bunuh sesama tim merah
    if(target?.team === 'red') { UI.toast('Tidak bisa menyerang sesama tim!','warn'); return; }

    // Simpan lastKillTarget ke player doc agar persisten
    await DB.updatePlayer(State.roomCode, State.playerId, { lastKillTarget: State.selectedTarget });
    await this._submitAction('kill', State.selectedTarget);
    UI.showActionAnim('🐺', 1500);
    UI.toast('Serangan dikirim!', 'success');
  },

  async doDoppleganger() {
    if(State.myRole !== 'doppleganger') { console.warn('[Security] Role mismatch blocked'); return; }
    if(!State.selectedTarget) { UI.toast('Pilih target!','warn'); return; }
    const target = State.players[State.selectedTarget];
    if(!target) return;

    // Validasi target punya role yang valid
    if(!target.role || !ROLES[target.role]) {
      UI.toast('Target tidak memiliki role yang valid!','warn'); return;
    }
    if(State.selectedTarget === State.playerId) {
      UI.toast('Tidak bisa menyerang diri sendiri!','warn'); return;
    }

    // BUFF: Hanya bisa mencuri dari tim biru
    if(target.team !== 'blue') {
      UI.toast('Doppleganger hanya bisa menyerang tim biru untuk mencuri skill!','warn'); return;
    }

    // Cek limit skill yang sudah dicuri (maks 3)
    const currentSkills = State.doppleSkills || [];
    if(currentSkills.length >= 3) {
      UI.toast('Sudah mencuri 3 skill! Tidak bisa mencuri lagi.','warn'); return;
    }

    // Cek apakah skill ini sudah pernah dicuri
    if(currentSkills.includes(target.role)) {
      UI.toast(`Skill ${ROLES[target.role].name} sudah pernah dicuri!`,'warn'); return;
    }

    // Submit aksi kill (target akan mati, skill dicuri)
    await this._submitAction('dopple', State.selectedTarget);
    UI.showActionAnim('👤', 1500);
    UI.toast(`Menyerang ${escapeHtml(target.name)}! Jika berhasil, skill ${ROLES[target.role]?.name} akan dicuri.`, 'success', 5000);
  },

  async doVampire() {
    if(State.myRole !== 'vampire') { console.warn('[Security] Role mismatch blocked'); return; }
    if(!State.selectedTarget) { UI.toast('Pilih korban!','warn'); return; }
    // Vampire tidak bisa menyerang sesama purple
    const target = State.players[State.selectedTarget];
    if(target?.team === 'purple') { UI.toast('Vampire tidak bisa menyerang sesama!','warn'); return; }
    // Validasi vampire aktif (malam genap atau eclipse)
    const dayNum = State.room?.day || 1;
    const event = State.room?.currentEvent;
    if(dayNum % 2 !== 0 && event !== 'eclipse') {
      UI.toast('Vampire hanya aktif di malam genap!','warn'); return;
    }
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
    // Track doppleganger skill steals: { playerId: stolenRole }
    const doppleKills = {};

    if(event === 'fog') {
      return { killed: [], deaths: [], doppleKills: {} };
    }

    // 1. Heal (doctor only — witch heal sudah dihapus)
    Object.values(actions).forEach(a => {
      if(a.action === 'heal') healed.add(a.target);
    });

    // 2. Guard — BUFF: 100% berhasil (hapus Math.random)
    Object.values(actions).forEach(a => {
      if(a.action === 'guard') guarded.add(a.target);
    });

    // 3. Witch poison — NERF: cek apakah target tim biru (self-destruct)
    Object.entries(actions).forEach(([actorId, a]) => {
      if(a.action === 'witchPoison') {
        const witch = players[actorId];
        const t = players[a.target];
        if(!t?.alive) return;

        // Jika tidak dilindungi, bunuh target
        if(!healed.has(a.target) && !guarded.has(a.target)) {
          killed.add(a.target);
          deaths.push({ playerId: a.target, cause: 'Diracuni penyihir 🧙' });
        }

        // NERF: Jika target tim biru, penyihir meledak!
        if(t.team === 'blue' && witch?.alive) {
          killed.add(actorId);
          deaths.push({ playerId: actorId, cause: '💥 Penyihir meledak karena meracuni tim biru!' });
        }
      }
    });

    // 4. Werewolf kill
    Object.entries(room.nightActions || {}).forEach(([actorId, a]) => {
      if(a.action === 'kill') {
        const actor = players[actorId];
        if(!actor || actor.team !== 'red') return;
        const t = players[a.target];
        if(!t?.alive) return;
        if(healed.has(a.target) || guarded.has(a.target)) return;
        if(t.role === 'vampire') return;
        if(t.team === 'red') return;
        if(!killed.has(a.target)) {
          killed.add(a.target);
          deaths.push({ playerId: a.target, cause: 'Dimangsa serigala 🐺' });
        }
      }
    });

    // 5. Doppleganger kill — BUFF: bunuh tim biru dan curi skillnya
    Object.entries(actions).forEach(([actorId, a]) => {
      if(a.action === 'dopple') {
        const actor = players[actorId];
        if(!actor || actor.team !== 'red') return;
        const t = players[a.target];
        if(!t?.alive) return;
        // Hanya bisa bunuh tim biru
        if(t.team !== 'blue') return;
        if(healed.has(a.target) || guarded.has(a.target)) return;

        if(!killed.has(a.target)) {
          killed.add(a.target);
          deaths.push({ playerId: a.target, cause: 'Diserang Doppleganger 👤' });
          // Catat skill yang dicuri
          if(t.role && ROLES[t.role]) {
            doppleKills[actorId] = t.role;
          }
        }
      }
    });

    // 6. Vampire kill
    const dayNum = room.day || 1;
    if(dayNum % 2 === 0 || event === 'eclipse') {
      Object.values(actions).forEach(a => {
        if(a.action === 'vampKill') {
          const t = players[a.target];
          if(!t?.alive) return;
          if(healed.has(a.target) || guarded.has(a.target)) return;
          if(!killed.has(a.target)) {
            killed.add(a.target);
            deaths.push({ playerId: a.target, cause: 'Diserang vampire 🧛' });
          }
        }
      });
    }

    return { killed: [...killed], deaths, doppleKills };
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

  // Jika tidak ada pemain hidup sama sekali — game over tanpa pemenang (edge case)
  if(alive.length === 0) return 'blue'; // Default ke blue

  const allMonstersGone = red.length === 0 && purple.length === 0;

  // Tim Biru menang jika semua musuh (merah & ungu) mati dan masih ada biru hidup
  if(allMonstersGone && blue.length > 0) return 'blue';

  // Tim Merah menang jika:
  // Jumlah merah >= total semua non-merah (mereka bisa mendominasi voting)
  // DAN biru dan ungu sudah tidak bisa menghentikan mereka
  const nonRed = alive.length - red.length;
  if(red.length > 0 && red.length >= nonRed && blue.length === 0) return 'red';

  // Tim Ungu menang jika semua tim lain mati (hanya ungu tersisa)
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

  // Rate limiter untuk chat
  _lastSentTime: {},
  _CHAT_COOLDOWN_MS: 1500, // 1.5 detik antar pesan

  async _send(inputId, type) {
    const inp = document.getElementById(inputId);
    if(!inp) return;

    const rawText = inp.value.trim();
    if(!rawText) return;

    // Validasi panjang pesan
    if(rawText.length > 200) { UI.toast('Pesan terlalu panjang (maks 200 karakter)!','warn'); return; }
    if(rawText.length < 1)   return;

    // Rate limiting per channel
    const now = Date.now();
    const lastSent = this._lastSentTime[type] || 0;
    if(now - lastSent < this._CHAT_COOLDOWN_MS) {
      UI.toast('Tunggu sebentar sebelum mengirim pesan lagi!','warn'); return;
    }

    // Validasi state
    if(!State.roomCode) return;
    if(!State.playerId || !State.playerName) return;

    // Pemain mati hanya bisa kirim pesan 'dead'
    if(!State.myAlive && type !== 'dead') {
      UI.toast('Pemain mati hanya bisa chat di channel arwah!','warn'); return;
    }

    // Wolf chat hanya untuk tim merah
    if(type === 'wolf' && State.myTeam !== 'red') {
      console.warn('[Security] Non-red player tried to send wolf chat');
      return;
    }

    this._lastSentTime[type] = now;
    inp.value = '';

    await DB.addMessage(State.roomCode, {
      sender: State.playerId,
      name: State.playerName,
      text: rawText,   // escapeHtml applied on render, not storage
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
    // Remove previous resize listener to prevent leak on re-init
    if(this._resizeHandler) window.removeEventListener('resize', this._resizeHandler);
    this._resizeHandler = () => this.resize();
    window.addEventListener('resize', this._resizeHandler);
    this.loop();
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
    if(!ak || !pi || !ai) {
      UI.toast('Isi semua field konfigurasi!','warn');
      return;
    }
    // Validasi format minimal
    if(ak.length < 10 || pi.length < 3 || ai.length < 5) {
      UI.toast('Format konfigurasi tidak valid!','warn');
      return;
    }
    // CATATAN KEAMANAN: API key Firebase disimpan di localStorage.
    // Ini aman karena Firebase API key adalah PUBLIC key (bukan secret).
    // Keamanan sebenarnya ada di Firestore Security Rules.
    try {
      localStorage.setItem('ww_fb_config', JSON.stringify({ apiKey:ak, projectId:pi, appId:ai }));
      UI.toast('Config disimpan. Muat ulang halaman...','success');
      setTimeout(() => location.reload(), 1500);
    } catch(e) {
      UI.toast('Gagal simpan config: ' + e.message, 'error');
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
  if(typeof str !== 'string') return '';
  return str
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#x27;')
    .replace(/`/g,'&#x60;');
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
