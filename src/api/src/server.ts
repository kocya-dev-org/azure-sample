import express from 'express';
import path from 'node:path';
import { CosmosClient } from '@azure/cosmos';
import { BlobServiceClient } from '@azure/storage-blob';

const app = express();
app.use(express.json({ limit: '10mb' }));
const cosmos = new CosmosClient(required('COSMOS_CONNECTION_STRING'))
  .database(process.env.COSMOS_DATABASE_ID ?? 'flyingfish')
  .container(process.env.COSMOS_CONTAINER_ID ?? 'records');
const blobs = BlobServiceClient.fromConnectionString(required('BLOB_CONNECTION_STRING'))
  .getContainerClient(process.env.BLOB_CONTAINER_NAME ?? 'objects');
const api = express.Router();
const error = (res: express.Response, status: number, message: string) => res.status(status).json({ error: message });
const statusOf = (e: unknown) => typeof e === 'object' && e !== null && 'code' in e ? Number(e.code) :
  typeof e === 'object' && e !== null && 'statusCode' in e ? Number(e.statusCode) : 500;

api.get('/hello', (_req, res) => res.json({ message: 'Express API から応答しています。', service: 'flyingfish-api' }));
api.get('/goodbye', (_req, res) => res.json({ message: 'goodbyeコメント' }));
api.post('/jobs/run', (_req, res) => res.json({ message: 'ジョブを手動実行しました。', invocationPath: 'Manual' }));
api.get('/items', async (_req, res) => {
  try { res.json((await cosmos.items.query('SELECT * FROM c').fetchAll()).resources); }
  catch (e) { console.error('Cosmos list failed', e); error(res, 500, 'Cosmos DB の読み込みに失敗しました。'); }
});
api.post('/items', async (req, res) => {
  const record = req.body;
  if (!record || typeof record !== 'object' || Array.isArray(record)) return error(res, 400, 'JSON オブジェクトを指定してください。');
  if (typeof record.id !== 'string' || !record.id.trim()) return error(res, 400, 'id は空でない文字列で指定してください。');
  try { res.status(201).json((await cosmos.items.create(record)).resource); }
  catch (e) { console.error('Cosmos create failed', e); const s = statusOf(e); error(res, s === 409 ? 409 : 500, s === 409 ? '同じ id のレコードがすでにあります。' : 'Cosmos DB の作成に失敗しました。'); }
});
api.get('/items/:id', async (req, res) => {
  try { const { resource } = await cosmos.item(req.params.id, req.params.id).read(); resource ? res.json(resource) : error(res, 404, 'レコードが見つかりません。'); }
  catch (e) { const s = statusOf(e); error(res, s === 404 ? 404 : 500, s === 404 ? 'レコードが見つかりません。' : 'Cosmos DB の読み込みに失敗しました。'); }
});
api.put('/items/:id', async (req, res) => {
  if (!req.body || req.body.id !== req.params.id) return error(res, 400, 'URL の id と JSON の id を一致させてください。');
  try { res.json((await cosmos.item(req.params.id, req.params.id).replace(req.body)).resource); }
  catch (e) { const s = statusOf(e); error(res, s === 404 ? 404 : 500, s === 404 ? '更新するレコードが見つかりません。' : 'Cosmos DB の更新に失敗しました。'); }
});
api.delete('/items/:id', async (req, res) => {
  try { await cosmos.item(req.params.id, req.params.id).delete(); res.status(204).end(); }
  catch (e) { const s = statusOf(e); error(res, s === 404 ? 404 : 500, s === 404 ? '削除するレコードが見つかりません。' : 'Cosmos DB の削除に失敗しました。'); }
});
api.all('/blobs/:name', async (req, res) => {
  const blob = blobs.getBlockBlobClient(req.params.name);
  try {
    if (req.method === 'GET') { const b = await blobs.getBlobClient(req.params.name).downloadToBuffer(); return res.json({ name: req.params.name, content: b.toString('utf8') }); }
    if (req.method === 'DELETE') { const r = await blobs.getBlobClient(req.params.name).deleteIfExists(); return r.succeeded ? res.status(204).end() : error(res, 404, '削除するオブジェクトが見つかりません。'); }
    if (!['POST', 'PUT'].includes(req.method)) return res.sendStatus(405);
    if (typeof req.body?.content !== 'string') return error(res, 400, 'content に文字列を指定してください。');
    await blob.uploadData(Buffer.from(req.body.content), { ...(req.method === 'POST' ? { conditions: { ifNoneMatch: '*' } } : {}), blobHTTPHeaders: { blobContentType: 'text/plain; charset=utf-8' } });
    return res.status(req.method === 'POST' ? 201 : 200).json({ name: req.params.name, content: req.body.content });
  } catch (e) { const s = statusOf(e); console.error('Blob operation failed', e); return error(res, s === 404 ? 404 : s === 412 ? 409 : 500, s === 404 ? 'オブジェクトが見つかりません。' : s === 412 ? '同じ名前のオブジェクトがすでにあります。' : 'Blob 操作に失敗しました。'); }
});
app.use('/api', api);
app.use(express.static(path.resolve(process.env.FRONTEND_PATH ?? '../frontend')));
app.get('/{*splat}', (_req, res) => res.sendFile(path.resolve(process.env.FRONTEND_PATH ?? '../frontend', 'index.html')));
app.listen(process.env.PORT ?? 8080, () => console.log('Flyingfish App Service listening'));
function required(name: string): string { const value = process.env[name]; if (!value) throw new Error(`Missing setting: ${name}`); return value; }
