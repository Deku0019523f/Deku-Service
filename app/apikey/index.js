import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

const SESSIONS_DIR = './sessions';

export function generateApiKey() {
  return uuidv4(); // format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
}

export function saveApiKey(phoneNumber, apiKey) {
  const dir = path.join(SESSIONS_DIR, phoneNumber);
  fs.mkdirSync(dir, { recursive: true });

  const data = {
    apiKey,
    phoneNumber,
    createdAt: new Date().toISOString(),
    status: 'active',
  };

  fs.writeFileSync(path.join(dir, 'api-key.json'), JSON.stringify(data, null, 2));
  return data;
}

export function loadApiKey(phoneNumber) {
  const filePath = path.join(SESSIONS_DIR, phoneNumber, 'api-key.json');
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function sessionExists(phoneNumber) {
  const credsPath = path.join(SESSIONS_DIR, phoneNumber, 'creds.json');
  return fs.existsSync(credsPath);
}

export function listSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  return fs.readdirSync(SESSIONS_DIR).filter(d =>
    fs.existsSync(path.join(SESSIONS_DIR, d, 'creds.json'))
  );
}
