const express = require('express');
const path    = require('path');

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ╔══════════════════════════════════════════════════════╗
// ║  ⚙️  METTEZ VOS ADRESSES IP ICI (une par ligne)     ║
// ╚══════════════════════════════════════════════════════╝
const OWNER_IPS = [
  '127.0.0.1',
  '::1',
  '2a02:8428:141c:a201:ec78:9355:bafa:4487',
];

const OWNER_NAME = 'Assistant virtuel';

// ── Stockage (Datastore si dispo, sinon mémoire) ─────
let useDatastore = false;
let datastore    = null;
const memMessages = [];
const memEvents   = [];

try {
  const { Datastore } = require('@google-cloud/datastore');
  datastore    = new Datastore();
  useDatastore = true;
  console.log('Datastore OK');
} catch (e) {
  console.warn('Datastore indisponible, mode memoire:', e.message);
}

function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = forwarded ? forwarded.split(',')[0].trim()
                        : (req.socket?.remoteAddress || req.ip || '');
  return raw.replace(/^::ffff:/, '');
}

function isOwner(req) {
  const ip = getClientIP(req);
  return OWNER_IPS.map(i => i.replace(/^::ffff:/, '')).includes(ip);
}

// ── Chat routes ───────────────────────────────────────
app.get('/api/chat/whoami', (req, res) => {
  const owner = isOwner(req);
  res.json({ role: owner ? 'owner' : 'guest', name: owner ? OWNER_NAME : 'Invité', ip: getClientIP(req) });
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
    console.error('Datastore GET chat error:', err.message);
    res.json(memMessages);
  }
});

app.post('/api/chat/send', async (req, res) => {
  const { text, guestName } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Message vide' });

  const owner = isOwner(req);
  // Les invités peuvent envoyer leur prénom (saisi sur la page d'accueil)
  const displayName = owner ? OWNER_NAME : (guestName?.trim().slice(0, 30) || 'Invité');

  const msg = {
    sender: owner ? 'owner' : 'guest',
    name:   displayName,
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
      console.error('Datastore SAVE chat error:', err.message);
    }
  }

  res.json({ ok: true, sender: msg.sender, name: msg.name });
});

// ── Calendar routes ───────────────────────────────────
app.get('/api/calendar/events', async (req, res) => {
  if (!useDatastore) return res.json(memEvents);
  try {
    const [events] = await datastore.runQuery(
      datastore.createQuery('NebuCalendarEvent').order('startDate').limit(500)
    );
    res.json(events.map(e => ({
      id:        String(e[datastore.KEY].id || ''),
      title:     e.title,
      startDate: e.startDate,
      endDate:   e.endDate,
      startTime: e.startTime || '',
      endTime:   e.endTime   || '',
      color:     e.color     || 'blue',
    })));
  } catch (err) {
    console.error('Datastore GET calendar error:', err.message);
    res.json(memEvents);
  }
});

app.post('/api/calendar/events', async (req, res) => {
  const { title, startDate, endDate, startTime, endTime, color } = req.body;
  if (!title?.trim() || !startDate) return res.status(400).json({ error: 'Données manquantes' });

  const event = {
    title:     title.trim().slice(0, 100),
    startDate,
    endDate:   endDate || startDate,
    startTime: startTime || '',
    endTime:   endTime   || '',
    color:     color     || 'blue',
    createdAt: new Date().toISOString(),
  };

  if (!useDatastore) {
    event.id = Date.now().toString();
    memEvents.push(event);
    return res.json({ ok: true, event });
  }

  try {
    const key = datastore.key('NebuCalendarEvent');
    await datastore.save({
      key,
      data: Object.entries(event).map(([name, value]) => ({ name, value })),
    });
    event.id = String(key.id);
    res.json({ ok: true, event });
  } catch (err) {
    console.error('Datastore SAVE calendar error:', err.message);
    event.id = Date.now().toString();
    memEvents.push(event);
    res.json({ ok: true, event });
  }
});

app.delete('/api/calendar/events/:id', async (req, res) => {
  const { id } = req.params;
  if (!useDatastore) {
    const idx = memEvents.findIndex(e => e.id === id);
    if (idx !== -1) memEvents.splice(idx, 1);
    return res.json({ ok: true });
  }
  try {
    await datastore.delete(datastore.key(['NebuCalendarEvent', datastore.int(id)]));
    res.json({ ok: true });
  } catch (err) {
    console.error('Datastore DELETE calendar error:', err.message);
    res.json({ ok: false });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, datastore: useDatastore });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
