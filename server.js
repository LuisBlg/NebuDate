const express = require('express');
const path = require('path');
const { Datastore } = require('@google-cloud/datastore');

const app = express();
app.set('trust proxy', true); // Obligatoire derrière Cloud Run / load balancer
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ══════════════════════════════════════════════════════
//  ⚙️  CONFIGURATION – Mettez ici vos adresses IP
//  Vous pouvez aussi définir la variable d'env OWNER_IPS
//  (séparées par des virgules) dans Cloud Run.
// ══════════════════════════════════════════════════════
const OWNER_IPS = process.env.OWNER_IPS
  ? process.env.OWNER_IPS.split(',').map(ip => ip.trim())
  : [
      '127.0.0.1',   // localhost (dev)
      '::1',         // localhost IPv6
      // Ajoutez vos IPs ici, ex:
      // '90.12.34.56',
      // '82.64.12.89',
    ];

// Noms affichés dans le chat
const OWNER_NAME  = process.env.OWNER_NAME  || 'Louis';
const GUEST_NAME  = process.env.GUEST_NAME  || 'Invité';

// ══════════════════════════════════════════════════════
const datastore = new Datastore();

function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || req.ip;
}

function isOwner(req) {
  return OWNER_IPS.includes(getClientIP(req));
}

// ── GET /api/chat/whoami ─────────────────────────────
// Indique à l'interface quel utilisateur vous êtes
app.get('/api/chat/whoami', (req, res) => {
  const owner = isOwner(req);
  res.json({
    role: owner ? 'owner' : 'guest',
    name: owner ? OWNER_NAME : GUEST_NAME,
    ip: getClientIP(req),
  });
});

// ── GET /api/chat/messages ───────────────────────────
// Retourne les 200 derniers messages (du plus ancien au plus récent)
app.get('/api/chat/messages', async (req, res) => {
  try {
    const query = datastore
      .createQuery('NebuChatMessage')
      .order('timestamp')
      .limit(200);
    const [messages] = await datastore.runQuery(query);
    res.json(messages.map(m => ({
      id:        m[datastore.KEY].id,
      sender:    m.sender,
      name:      m.name,
      text:      m.text,
      timestamp: m.timestamp,
    })));
  } catch (err) {
    console.error('GET /api/chat/messages error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── POST /api/chat/send ──────────────────────────────
// Enregistre un message dans Datastore
app.post('/api/chat/send', async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Message vide' });

  const owner  = isOwner(req);
  const sender = owner ? 'owner' : 'guest';
  const name   = owner ? OWNER_NAME : GUEST_NAME;

  const key    = datastore.key('NebuChatMessage');
  const entity = {
    key,
    data: [
      { name: 'sender',    value: sender },
      { name: 'name',      value: name },
      { name: 'text',      value: text.trim().slice(0, 500) },
      { name: 'timestamp', value: new Date().toISOString() },
    ],
  };

  try {
    await datastore.save(entity);
    res.json({ ok: true, sender, name });
  } catch (err) {
    console.error('POST /api/chat/send error:', err);
    res.status(500).json({ error: 'Erreur sauvegarde' });
  }
});

// ── GET /api/health ──────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', message: 'API fonctionne' });
});

// ── Démarrage ────────────────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Owner IPs: ${OWNER_IPS.join(', ')}`);
});
