import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

const OUTPUT_DIR = './output';

export async function generateGuidePDF(phoneNumber, apiKey, date) {
  return new Promise((resolve, reject) => {
    const dir = path.join(OUTPUT_DIR, phoneNumber);
    fs.mkdirSync(dir, { recursive: true });
    const outputPath = path.join(dir, 'guide.pdf');

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    // ─── COULEURS & HELPERS ───────────────────────────────────────────
    const C = {
      primary:   '#075E54',   // vert WhatsApp
      accent:    '#25D366',
      dark:      '#1a1a2e',
      light:     '#f0fdf4',
      gray:      '#6b7280',
      danger:    '#ef4444',
      warning:   '#f59e0b',
      white:     '#ffffff',
    };

    const W = doc.page.width;    // 595
    const M = 50;                 // margin
    const CW = W - M * 2;        // content width = 495

    function rule(y, color = C.accent) {
      doc.moveTo(M, y).lineTo(W - M, y).stroke(color);
    }

    function badge(x, y, text, bg = C.accent) {
      const pad = 8;
      const tw  = doc.widthOfString(text) + pad * 2;
      doc.roundedRect(x, y - 2, tw, 18, 4).fill(bg);
      doc.fill(C.white).font('Helvetica-Bold').fontSize(9).text(text, x + pad, y + 1, { lineBreak: false });
      doc.fill(C.dark);
      return x + tw + 6;
    }

    function sectionTitle(title, emoji = '') {
      doc.moveDown(0.6);
      const y = doc.y;
      doc.rect(M, y, 4, 20).fill(C.accent);
      doc.fill(C.primary).font('Helvetica-Bold').fontSize(14)
         .text(`${emoji}  ${title}`, M + 14, y + 3);
      doc.fill(C.dark).moveDown(0.4);
      rule(doc.y);
      doc.moveDown(0.4);
    }

    function codeBlock(lines, label = '') {
      const blockY = doc.y;
      const lineH  = 16;
      const pad    = 12;
      const height = lines.length * lineH + pad * 2;
      doc.rect(M, blockY, CW, height).fill('#1e293b').stroke('#334155');
      if (label) {
        doc.fill('#94a3b8').font('Helvetica').fontSize(8)
           .text(label, M + pad, blockY + 5, { lineBreak: false });
      }
      lines.forEach((line, i) => {
        doc.fill('#7dd3fc').font('Courier').fontSize(9)
           .text(line, M + pad, blockY + pad + (label ? 8 : 0) + i * lineH, { lineBreak: false });
      });
      doc.fill(C.dark).y = blockY + height + 6;
      doc.moveDown(0.2);
    }

    // ═══════════════════════════════════════════════════════════════════
    // PAGE 1 — COUVERTURE
    // ═══════════════════════════════════════════════════════════════════
    // Header gradient-like banner
    doc.rect(0, 0, W, 200).fill(C.primary);
    doc.rect(0, 180, W, 30).fill(C.accent);

    // Logo area
    const logoPath = './assets/logo.png';
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, W / 2 - 40, 25, { width: 80, height: 80 });
    } else {
      // Fallback circle logo
      doc.circle(W / 2, 65, 40).fill(C.accent);
      doc.fill(C.white).font('Helvetica-Bold').fontSize(22)
         .text('WA', W / 2 - 14, 55, { lineBreak: false });
    }

    doc.fill(C.white).font('Helvetica-Bold').fontSize(24)
       .text('WhatsApp API Agent', M, 120, { align: 'center', width: CW });
    doc.fill('#d1fae5').font('Helvetica').fontSize(12)
       .text('Guide d\'intégration & Documentation', M, 150, { align: 'center', width: CW });

    // Info card
    doc.roundedRect(M, 220, CW, 130, 8)
       .fill(C.light).stroke('#d1fae5');

    doc.fill(C.primary).font('Helvetica-Bold').fontSize(11)
       .text('Informations de connexion', M + 20, 238);
    rule(256, '#bbf7d0');

    const rows = [
      ['📱 Numéro WhatsApp', phoneNumber],
      ['📅 Date de génération',  date],
      ['🔑 Statut clé API',       'Active ✅'],
    ];
    rows.forEach(([k, v], i) => {
      const ry = 266 + i * 24;
      doc.fill(C.gray).font('Helvetica').fontSize(10).text(k, M + 20, ry, { lineBreak: false });
      doc.fill(C.dark).font('Helvetica-Bold').text(v, M + 200, ry, { lineBreak: false });
    });

    // API Key box
    doc.roundedRect(M, 370, CW, 60, 8).fill('#fff7ed').stroke('#fed7aa');
    doc.fill(C.warning).font('Helvetica-Bold').fontSize(10)
       .text('🔐  Votre Clé API Personnelle', M + 15, 382);
    doc.fill('#92400e').font('Courier-Bold').fontSize(13)
       .text(apiKey, M + 15, 400, { align: 'center', width: CW - 30 });

    // Warning
    doc.roundedRect(M, 448, CW, 36, 6).fill('#fef2f2').stroke('#fca5a5');
    doc.fill(C.danger).font('Helvetica-Bold').fontSize(10)
       .text('⚠️  Ne partagez jamais cette clé. Elle donne accès total à votre compte.', M + 15, 460,
             { width: CW - 30 });

    doc.fill(C.gray).font('Helvetica').fontSize(9)
       .text(`WhatsApp API Agent  •  ${date}  •  Guide v1.0`, M, 780, { align: 'center', width: CW });

    // ═══════════════════════════════════════════════════════════════════
    // PAGE 2 — PRÉSENTATION & DÉMARRAGE
    // ═══════════════════════════════════════════════════════════════════
    doc.addPage();

    doc.rect(0, 0, W, 60).fill(C.primary);
    doc.fill(C.white).font('Helvetica-Bold').fontSize(16)
       .text('📘  Présentation du service', M, 20, { width: CW });
    doc.fill('#d1fae5').font('Helvetica').fontSize(10)
       .text('Ce que vous pouvez faire avec votre clé API', M, 42, { width: CW });

    doc.y = 80;

    doc.fill(C.dark).font('Helvetica').fontSize(11).text(
      `WhatsApp API Agent transforme votre compte WhatsApp personnel en une puissante ` +
      `API d'envoi de messages. Grâce à votre clé API unique, vous pouvez automatiser ` +
      `l'envoi de messages texte, d'images, de documents et d'emojis — directement ` +
      `depuis vos applications, scripts ou workflows.`,
      M, doc.y, { width: CW, lineGap: 4 }
    );

    doc.moveDown(1);

    // Feature cards
    const features = [
      { icon: '💬', title: 'Messages texte',   desc: 'Envoyez des messages texte simples ou enrichis.' },
      { icon: '🖼️',  title: 'Images & médias',  desc: 'Envoyez des photos, logos et captures d\'écran.' },
      { icon: '📄', title: 'Documents PDF',    desc: 'Partagez des fichiers PDF, Word, Excel, etc.' },
      { icon: '😀', title: 'Emojis & Unicode', desc: 'Intégrez des emojis dans vos messages.' },
    ];

    const cardW = (CW - 12) / 2;
    features.forEach((f, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cx = M + col * (cardW + 12);
      const cy = doc.y + row * 80 + (row > 0 ? 8 : 0);
      doc.roundedRect(cx, cy, cardW, 68, 6).fill(C.light).stroke('#d1fae5');
      doc.fill(C.primary).font('Helvetica-Bold').fontSize(20)
         .text(f.icon, cx + 12, cy + 10, { lineBreak: false });
      doc.fill(C.dark).font('Helvetica-Bold').fontSize(11)
         .text(f.title, cx + 50, cy + 12, { lineBreak: false });
      doc.fill(C.gray).font('Helvetica').fontSize(9)
         .text(f.desc, cx + 50, cy + 30, { width: cardW - 60 });
    });

    doc.y += 180;

    sectionTitle('Rôle de la Clé API', '🔑');
    doc.fill(C.dark).font('Helvetica').fontSize(10).text(
      `Chaque clé API est unique et liée à votre session WhatsApp. Elle permet :\n` +
      `• D'authentifier toutes vos requêtes d'envoi\n` +
      `• De tracer et limiter les usages si nécessaire\n` +
      `• De révoquer l'accès sans toucher à votre compte WhatsApp\n\n` +
      `Conservez-la dans un fichier de configuration sécurisé ou une variable d'environnement.`,
      M, doc.y, { width: CW, lineGap: 3 }
    );

    doc.fill(C.gray).font('Helvetica').fontSize(9)
       .text(`Page 2  •  WhatsApp API Agent`, M, 780, { align: 'center', width: CW });

    // ═══════════════════════════════════════════════════════════════════
    // PAGE 3 — UTILISATION & ENDPOINTS
    // ═══════════════════════════════════════════════════════════════════
    doc.addPage();

    doc.rect(0, 0, W, 60).fill(C.primary);
    doc.fill(C.white).font('Helvetica-Bold').fontSize(16)
       .text('⚡  Utilisation de l\'API', M, 20, { width: CW });
    doc.fill('#d1fae5').font('Helvetica').fontSize(10)
       .text('Exemples d\'appels avec curl, JavaScript et Python', M, 42, { width: CW });

    doc.y = 80;

    // Send text message
    sectionTitle('Envoyer un message texte', '💬');
    codeBlock([
      `POST /api/send/text`,
      `Authorization: Bearer ${apiKey}`,
      `Content-Type: application/json`,
      ``,
      `{`,
      `  "to":      "2250712345678",`,
      `  "message": "Bonjour depuis mon API !"`,
      `}`,
    ], 'HTTP Request');

    codeBlock([
      `const res = await fetch('http://localhost:3000/api/send/text', {`,
      `  method: 'POST',`,
      `  headers: {`,
      `    'Authorization': 'Bearer ${apiKey.substring(0,16)}...',`,
      `    'Content-Type':  'application/json'`,
      `  },`,
      `  body: JSON.stringify({ to: '2250712345678', message: 'Hello!' })`,
      `});`,
    ], 'JavaScript (fetch)');

    // Send emoji
    sectionTitle('Envoyer un emoji', '😀');
    codeBlock([
      `{`,
      `  "to":      "2250712345678",`,
      `  "message": "Merci pour votre confiance 🙏🎉"`,
      `}`,
    ], 'Body JSON');

    doc.fill(C.gray).font('Helvetica').fontSize(9)
       .text(`Page 3  •  WhatsApp API Agent`, M, 780, { align: 'center', width: CW });

    // ═══════════════════════════════════════════════════════════════════
    // PAGE 4 — IMAGES, DOCUMENTS & FORMAT NUMÉROS
    // ═══════════════════════════════════════════════════════════════════
    doc.addPage();

    doc.rect(0, 0, W, 60).fill(C.primary);
    doc.fill(C.white).font('Helvetica-Bold').fontSize(16)
       .text('📁  Médias & Format des numéros', M, 20, { width: CW });

    doc.y = 80;

    // Send image
    sectionTitle('Envoyer une image', '🖼️');
    codeBlock([
      `POST /api/send/image`,
      ``,
      `{`,
      `  "to":      "2250712345678",`,
      `  "url":     "https://example.com/photo.jpg",`,
      `  "caption": "Voici votre reçu 📷"`,
      `}`,
    ], 'HTTP Request');

    // Send document
    sectionTitle('Envoyer un document', '📄');
    codeBlock([
      `POST /api/send/document`,
      ``,
      `{`,
      `  "to":       "2250712345678",`,
      `  "url":      "https://example.com/rapport.pdf",`,
      `  "filename": "Rapport_Q3_2024.pdf",`,
      `  "caption":  "Voici le rapport mensuel"`,
      `}`,
    ], 'HTTP Request');

    // Phone number format
    sectionTitle('Format des numéros de téléphone', '📱');

    doc.fill(C.dark).font('Helvetica-Bold').fontSize(10)
       .text('Règles à respecter :', M, doc.y);
    doc.moveDown(0.3);
    [
      '✅ Format international complet (indicatif pays inclus)',
      '✅ Uniquement des chiffres, sans espace ni tiret',
      '✅ Sans le signe + au début',
      '❌ +2250712345678   →   invalide',
      '❌ 07 12 34 56 78   →   invalide',
      '❌ 225-0712345678   →   invalide',
      '✅ 2250712345678    →   valide',
      '✅ 33612345678      →   valide (France)',
      '✅ 12025550123      →   valide (USA)',
    ].forEach(line => {
      const color = line.startsWith('✅') ? '#16a34a' : line.startsWith('❌') ? C.danger : C.dark;
      doc.fill(color).font('Helvetica').fontSize(10)
         .text(line, M + 10, doc.y, { lineBreak: true });
    });

    doc.fill(C.gray).font('Helvetica').fontSize(9)
       .text(`Page 4  •  WhatsApp API Agent`, M, 780, { align: 'center', width: CW });

    // ═══════════════════════════════════════════════════════════════════
    // PAGE 5 — ERREURS & SÉCURITÉ
    // ═══════════════════════════════════════════════════════════════════
    doc.addPage();

    doc.rect(0, 0, W, 60).fill(C.primary);
    doc.fill(C.white).font('Helvetica-Bold').fontSize(16)
       .text('🚨  Erreurs & Sécurité', M, 20, { width: CW });

    doc.y = 80;

    sectionTitle('Codes d\'erreur courants', '⚠️');

    const errors = [
      { code: '401', label: 'Unauthorized',      desc: 'Clé API manquante ou invalide' },
      { code: '400', label: 'Bad Request',        desc: 'Numéro de téléphone invalide ou paramètre manquant' },
      { code: '503', label: 'Service Unavailable',desc: 'Session WhatsApp déconnectée, relancer le script' },
      { code: '429', label: 'Too Many Requests',  desc: 'Limite de débit atteinte, patienter quelques secondes' },
      { code: '404', label: 'Not Found',          desc: 'Endpoint ou ressource introuvable' },
    ];

    errors.forEach(e => {
      const ey = doc.y;
      doc.roundedRect(M, ey, CW, 44, 5).fill('#fafafa').stroke('#e5e7eb');
      badge(M + 10, ey + 8, e.code, e.code === '401' || e.code === '503' ? C.danger : C.warning);
      doc.fill(C.dark).font('Helvetica-Bold').fontSize(10)
         .text(e.label, M + 60, ey + 8, { lineBreak: false });
      doc.fill(C.gray).font('Helvetica').fontSize(9)
         .text(e.desc, M + 60, ey + 24, { width: CW - 80 });
      doc.y = ey + 52;
    });

    // Reconnection
    sectionTitle('Session déconnectée', '🔄');
    doc.fill(C.dark).font('Helvetica').fontSize(10).text(
      `Si votre session WhatsApp se déconnecte, relancez simplement le script :\n` +
      `   node index.js\n\n` +
      `Le programme détectera la session existante et se reconnectera automatiquement.`,
      M, doc.y, { width: CW, lineGap: 3 }
    );

    doc.moveDown(1);
    sectionTitle('Sécurité & Bonnes pratiques', '🔒');

    const tips = [
      '🔐 Ne jamais partager votre clé API dans un dépôt Git public',
      '🌐 Stocker la clé dans une variable d\'environnement (.env)',
      '🔄 Régénérez votre clé si vous suspectez une compromission',
      '🚫 N\'exposez pas le serveur sur Internet sans authentification',
      '📋 Journalisez les appels API pour détecter des usages anormaux',
    ];
    tips.forEach(t => {
      doc.fill(C.dark).font('Helvetica').fontSize(10)
         .text(t, M + 10, doc.y, { lineBreak: true, lineGap: 4 });
    });

    // Final banner
    doc.moveDown(1);
    const bannerY = doc.y < 700 ? doc.y : 700;
    doc.roundedRect(M, bannerY, CW, 50, 8).fill(C.primary);
    doc.fill(C.white).font('Helvetica-Bold').fontSize(12)
       .text('Besoin d\'aide ?  Relancez le script : node index.js', M + 20, bannerY + 10, { width: CW - 40 });
    doc.fill('#d1fae5').font('Helvetica').fontSize(9)
       .text(`Clé API : ${apiKey}`, M + 20, bannerY + 30, { width: CW - 40 });

    doc.fill(C.gray).font('Helvetica').fontSize(9)
       .text(`Page 5  •  WhatsApp API Agent  •  ${date}`, M, 780, { align: 'center', width: CW });

    // ─── FINALIZE ────────────────────────────────────────────────────
    doc.end();
    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}
