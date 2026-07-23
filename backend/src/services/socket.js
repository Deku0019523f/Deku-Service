const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

function creerSocketIo(httpServer, corsOrigin) {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.vendeurId = payload.vendeurId;
      next();
    } catch (err) {
      next(new Error('Authentification Socket.io invalide'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`vendeur:${socket.vendeurId}`);
    logger.info({ vendeurId: socket.vendeurId }, 'Dashboard connecté en temps réel');

    socket.on('disconnect', () => {
      logger.info({ vendeurId: socket.vendeurId }, 'Dashboard déconnecté');
    });
  });

  return io;
}

module.exports = { creerSocketIo };
