import { serveMatchup } from '../lib/matchups.mjs';
export function GET(request) { return serveMatchup('games', request); }
