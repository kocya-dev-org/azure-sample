// Functions ホストのエントリーポイント。
// HTTP ストリーミングは関数の登録より前に有効にする必要があるため、
// app.setup を呼んでから各ハンドラーを読み込む。
import { app } from '@azure/functions';

app.setup({ enableHttpStream: true });

import './functions/diag-stream';
import './functions/goodbye';
import './functions/hello';
import './functions/items';
import './functions/blobs';
import './functions/jobs';
