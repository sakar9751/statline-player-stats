import { serveEndpoint } from '../lib/espn.mjs';
export function GET(request) { return serveEndpoint('search', request); }
