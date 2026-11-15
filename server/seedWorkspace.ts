import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_WORKSPACE_DIR } from './safety.js';

// Minimal valid 1x1 PNG pixel buffer (68 bytes) + custom metadata chunk payload
function createSamplePng(labelTag: string): Buffer {
  const basePng = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000080000000808020000004b6d29dc0000001e49444154789c6360c00a08448800c1100231c80c829081016419180200630f0129258281780000000049454e44ae426082',
    'hex'
  );
  // Append an inert PNG tEXt comment or keep exact bytes when identical duplicates are wanted
  return Buffer.concat([basePng, Buffer.from(`\n<!-- ${labelTag} -->`)]);
}

function createSamplePdf(title: string, body: string): Buffer {
  const content = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length ${44 + title.length + body.length} >>
stream
BT /F1 18 Tf 50 720 Td (${title}) Tj 0 -30 Td /F1 12 Tf (${body}) Tj ET
endstream
endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000241 00000 n 
0000000360 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
430
%%EOF`;
  return Buffer.from(content, 'utf8');
}

function createSampleWav(durationSamples = 4000): Buffer {
  const dataSize = durationSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(8000, 24);
  buf.writeUInt32LE(16000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < durationSamples; i++) {
    const sample = Math.round(Math.sin((i / 8000) * 440 * Math.PI * 2) * 8000);
    buf.writeInt16LE(sample, 44 + i * 2);
  }
  return buf;
}

function createMinimalZip(entryName: string, content: string): Buffer {
  // Valid minimal ZIP local file header + central directory + EOCD
  const nameBuf = Buffer.from(entryName, 'utf8');
  const dataBuf = Buffer.from(content, 'utf8');
  const localHeader = Buffer.alloc(30 + nameBuf.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt32LE(0, 14);
  localHeader.writeUInt32LE(dataBuf.length, 18);
  localHeader.writeUInt32LE(dataBuf.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);
  nameBuf.copy(localHeader, 30);

  const centralDir = Buffer.alloc(46 + nameBuf.length);
  centralDir.writeUInt32LE(0x02014b50, 0);
  centralDir.writeUInt16LE(20, 4);
  centralDir.writeUInt16LE(20, 6);
  centralDir.writeUInt32LE(dataBuf.length, 20);
  centralDir.writeUInt32LE(dataBuf.length, 24);
  centralDir.writeUInt16LE(nameBuf.length, 28);
  nameBuf.copy(centralDir, 46);

  const cdOffset = localHeader.length + dataBuf.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);

  return Buffer.concat([localHeader, dataBuf, centralDir, eocd]);
}

function setAgeDays(filePath: string, daysOld: number) {
  const past = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  fs.utimesSync(filePath, past, past);
}

export function ensureSeededWorkspace() {
  if (fs.existsSync(DEFAULT_WORKSPACE_DIR)) {
    const existing = fs.readdirSync(DEFAULT_WORKSPACE_DIR);
    if (existing.length > 0) return;
  }

  fs.mkdirSync(DEFAULT_WORKSPACE_DIR, { recursive: true });
  const inbox = path.join(DEFAULT_WORKSPACE_DIR, 'Downloads_Inbox');
  const media = path.join(DEFAULT_WORKSPACE_DIR, 'Media_Captures');
  const projects = path.join(DEFAULT_WORKSPACE_DIR, 'Project_Notes');
  const legacy = path.join(DEFAULT_WORKSPACE_DIR, 'Legacy_Backups');

  for (const dir of [inbox, media, projects, legacy]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 1. Exact duplicate set A: Financial PDF report (identical bytes across 2 folders)
  const reportPdf = createSamplePdf('Q4 Financial Summary', 'Net revenue growth 18.4 percent across EMEA and North America.');
  fs.writeFileSync(path.join(inbox, 'Q4_Financial_Summary.pdf'), reportPdf);
  fs.writeFileSync(path.join(legacy, 'Copy_of_Q4_Financial_Summary.pdf'), reportPdf);

  // 2. Exact duplicate set B: Hero banner SVG (identical bytes across 3 locations)
  const bannerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0B0B12"/>
      <stop offset="50%" stop-color="#8B5CF6" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#06B6D4" stop-opacity="0.35"/>
    </linearGradient>
  </defs>
  <rect width="800" height="450" fill="url(#g)"/>
  <circle cx="400" cy="225" r="110" fill="none" stroke="#8B5CF6" stroke-width="2"/>
  <text x="400" y="232" text-anchor="middle" fill="#F8FAFC" font-family="sans-serif" font-size="24">Architecture Diagram v2</text>
</svg>`;
  fs.writeFileSync(path.join(media, 'architecture_diagram.svg'), bannerSvg, 'utf8');
  fs.writeFileSync(path.join(projects, 'architecture_diagram_backup.svg'), bannerSvg, 'utf8');
  fs.writeFileSync(path.join(inbox, 'diagram_export.svg'), bannerSvg, 'utf8');

  // 3. Exact duplicate set C: Telemetry CSV dataset
  const csvRows = ['timestamp,node_id,cpu_pct,mem_mb,io_wait_ms'];
  for (let i = 0; i < 650; i++) {
    csvRows.push(`2026-08-${String((i % 28) + 1).padStart(2, '0')}T12:00:00Z,win-node-${(i % 4) + 1},${(18 + (i % 45)).toFixed(1)},${1024 + (i % 512)},${(1.2 + (i % 9) * 0.4).toFixed(2)}`);
  }
  const csvBuffer = Buffer.from(csvRows.join('\n'), 'utf8');
  fs.writeFileSync(path.join(projects, 'telemetry_export.csv'), csvBuffer);
  fs.writeFileSync(path.join(legacy, 'telemetry_export_archive.csv'), csvBuffer);

  // 4. Similarly named files with DIFFERENT content (to verify SHA-256 never false-positives on names!)
  fs.writeFileSync(
    path.join(projects, 'budget_2026_draft.csv'),
    'department,q1,q2,q3,q4\nEngineering,120000,125000,130000,140000\nDesign,45000,48000,50000,52000\n'
  );
  fs.writeFileSync(
    path.join(projects, 'budget_2026_draft (1).csv'),
    'department,q1,q2,q3,q4\nEngineering,124000,129000,136000,145000\nDesign,47000,49000,51000,54000\nOperations,38000,40000,41000,42000\n'
  );

  // 5. Code & config files
  fs.writeFileSync(
    path.join(projects, 'pipeline_sync.ts'),
    `export interface SyncJob {\n  id: string;\n  targetDir: string;\n  checksumAlgo: 'sha256';\n}\n\nexport function formatBytes(bytes: number): string {\n  const units = ['B', 'KB', 'MB', 'GB'];\n  let idx = 0;\n  let val = bytes;\n  while (val >= 1024 && idx < units.length - 1) {\n    val /= 1024;\n    idx++;\n  }\n  return \`\${val.toFixed(1)} \${units[idx]}\`;\n}\n`
  );
  fs.writeFileSync(
    path.join(projects, 'indexer.py'),
    `import hashlib\nfrom pathlib import Path\n\ndef sha256_stream(file_path: Path, chunk_size: int = 65536) -> str:\n    digest = hashlib.sha256()\n    with file_path.open("rb") as fh:\n        while chunk := fh.read(chunk_size):\n            digest.update(chunk)\n    return digest.hexdigest()\n`
  );
  fs.writeFileSync(
    path.join(projects, 'manifest.json'),
    JSON.stringify(
      {
        service: 'workstation-index',
        version: '2.4.0',
        watchedPaths: ['C:\\Users\\Operator\\Documents', 'C:\\Users\\Operator\\Downloads'],
        exclusions: ['*.tmp', 'Thumbs.db', 'node_modules'],
      },
      null,
      2
    )
  );

  // 6. Media: PNG & Audio WAV
  fs.writeFileSync(path.join(media, 'screenshot_dashboard_ui.png'), createSamplePng('screenshot-1'));
  fs.writeFileSync(path.join(media, 'chime_notification.wav'), createSampleWav(8000));

  // 7. Documents & Notes in root inbox (ready to be organized)
  fs.writeFileSync(
    path.join(DEFAULT_WORKSPACE_DIR, 'invoice_2026_104.md'),
    '# Invoice #2026-104\n\n- Client: Northstar Logistics\n- Date: 2026-10-12\n- Total Due: $4,850.00\n- Status: Settled\n'
  );
  fs.writeFileSync(
    path.join(inbox, 'meeting_notes_roadmap.txt'),
    'Q4 Desktop Roadmap Notes\n1. Finalize streaming SHA-256 worker thread pool\n2. Integrate Windows 11 Recycle Bin shell calls\n3. Add reversible organize history log in SQLite\n'
  );

  // 8. Archives & Installer-like executable binary stub
  const archiveBuf = createMinimalZip('notes.txt', 'Archived project release checklist and checksums.');
  fs.writeFileSync(path.join(inbox, 'release_bundle_v1.zip'), archiveBuf);

  const peHeaderStub = Buffer.alloc(64 * 1024, 0);
  peHeaderStub.write('MZ', 0); // Valid PE header signature for classifier verification
  peHeaderStub.write('FileForge Windows Installer Package Payload', 64);
  fs.writeFileSync(path.join(inbox, 'utility_setup_win64.exe'), peHeaderStub);

  // 9. Aged / Old files + Redundant clutter (temp, log, zero-byte, Thumbs.db)
  const oldArchive = path.join(legacy, 'legacy_backup_2024.zip');
  fs.writeFileSync(oldArchive, createMinimalZip('backup_2024.txt', 'Historical snapshot from 2024.'));
  setAgeDays(oldArchive, 420);

  const oldReport = path.join(legacy, 'annual_audit_2024.pdf');
  fs.writeFileSync(oldReport, createSamplePdf('Annual Audit 2024', 'Archived compliance report retained for reference.'));
  setAgeDays(oldReport, 310);

  const tempFile = path.join(inbox, 'download_cache_9921.tmp');
  fs.writeFileSync(tempFile, Buffer.alloc(24 * 1024, 0x41));
  setAgeDays(tempFile, 95);

  const logFile = path.join(legacy, 'sync_debug_old.log');
  fs.writeFileSync(logFile, '[2025-09-01] Completed batch index\n[2025-09-01] Zero errors detected\n'.repeat(120));
  setAgeDays(logFile, 210);

  const emptyFile = path.join(inbox, 'untitled_draft.txt');
  fs.writeFileSync(emptyFile, '');

  const thumbsFile = path.join(media, 'Thumbs.db');
  fs.writeFileSync(thumbsFile, Buffer.from('Windows Explorer Thumbnail Cache Stub'));
}
