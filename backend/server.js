require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const fs = require('fs');
const path = require('path');

const logger = require('./src/utils/logger');
const { creerSocketIo } = require('./src/services/socket');
const whatsappManager = require('./src/services/whatsappManager');

// S'assurer que les dossiers de données existent
fs.mkdirSync(path.join(__dirname, 'data', 'sessions'), { recursive: true });

const app = express();
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || '*' }));
app.use(express.json());

app.use('/api/auth', require('./src/routes/auth.routes'));
app.use('/api/whatsapp', require('./src/routes/whatsapp.routes'));
app.use('/api/produits', require('./src/routes/produits.routes'));
app.use('/api/conversations', require('./src/routes/conversations.routes'));

app.get('/api/sante', (req, res) => res.json({ statut: 'ok' }));

const server = http.createServer(app);
const io = creerSocketIo(server, process.env.FRONTEND_ORIGIN || '*');
whatsappManager.initSocketIo(io);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  logger.info(`Serveur démarré sur http://localhost:${PORT}`);
});
