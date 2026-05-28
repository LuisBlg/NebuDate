const express = require('express');
const path    = require('path');

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ╔══════════════════════════════════════════════════════╗
// ║  ⚙️  METTEZ VOS ADRESSES IP ICI (une par ligne)     ║
// ║  Cherchez "votre ip" sur Google pour la connaître   ║
// ╚══════════════════════════════════════════════════════╝
const OWNER_IPS = [
  '127.0.0.1',
  '::1',
  '81.65.172.242',
];

const OWNER_NAME = 'Hôte';
const GUEST_NAME = 'Invité';

// ── Stockage (Datastore si dispo, sinon mémoire) ─────
let useDatastore = false;
let datastore    = null;
const memMessages = [];

try {
  const { Datastore } = require('@google-cloud/datastore');
  datastore    = new Datastore();
  useDatastore = true;
  console.log('Datastore OK');
} catch (e) {
  console.warn('Datastore indisponible, mode memoire:', e.message);
}

// ── Normalisation IP (Cloud Run ajoute ::ffff: parfois) ─
function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = forwarded ? forwarded.split(',')[0].trim()
                        : (req.socket?.remoteAddress || req.ip || '');
  return raw.replace(/^::ffff:/, '');
}

function isOwner(req) {
  const ip = getClientIP(req);
  const normalizedOwners = OWNER_IPS.map(i => i.replace(/^::ffff:/, ''));
  const match = normalizedOwners.includes(ip);
  console.log(`IP=${ip} role=${match ? 'HOTE' : 'invite'}`);
  return match;
}

// ── Routes ───────────────────────────────────────────
app.get('/api/chat/whoami', (req, res) => {
  const owner = isOwner(req);
  res.json({ role: owner ? 'owner' : 'guest', name: owner ? OWNER_NAME : GUEST_NAME, ip: getClientIP(req) });
});

app.get('/api/chat/messages', async (req, res) => {
  if (!useDatastore) return res.json(memMessages);
  try {
    const [msgs] = await datastore.runQuery(
      datastore.createQuery('NebuChatMessage').order('timestamp').limit(200)
    );
    res.json(msgs.map(m => ({
      id: String(m[datastore.KEY].id || ''),
      sender: m.sender, name: m.name, text: m.text, timestamp: m.timestamp,
    })));
  } catch (err) {
    console.error('Datastore GET error:', err.message);
    res.json(memMessages);
  }
});

app.post('/api/chat/send', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Message vide' });

  const owner = isOwner(req);
  const msg = {
    sender: owner ? 'owner' : 'guest',
    name:   owner ? OWNER_NAME : GUEST_NAME,
    text:   text.trim().slice(0, 500),
    timestamp: new Date().toISOString(),
  };

  memMessages.push(msg);
  if (memMessages.length > 200) memMessages.shift();

  if (useDatastore) {
    try {
      await datastore.save({
        key: datastore.key('NebuChatMessage'),
        data: [
          { name: 'sender',    value: msg.sender    },
          { name: 'name',      value: msg.name      },
          { name: 'text',      value: msg.text      },
          { name: 'timestamp', value: msg.timestamp },
        ],
      });
    } catch (err) {
      console.error('Datastore SAVE error:', err.message);
    }
  }

  res.json({ ok: true, sender: msg.sender, name: msg.name });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, datastore: useDatastore });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
