#!/usr/bin/env bash
# DB バックアップ（prd/02 §7）。守るべき実体は可変データ（prd/03 §1 の下段: セッション・
# 回答ログ・スコア）だが、下段は上段（問題・プロファイル）への外部キーを持つため、
# **整合の取れた 1 スナップショットとして DB 全体をダンプする**（部分ダンプでは整合が壊れる。
# 上段はパイプラインの再実行と R2 からも再生できるので、含めて困ることはない）。
#
# 使い方:   pnpm db:backup            # ホストから。compose の db コンテナ内で mysqldump を実行
# 定期実行: ホストの cron に登録する（例: 0 5 * * * cd <repo> && pnpm db:backup）
# リストア: gunzip -c backups/<file>.sql.gz \
#             | docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot "$MYSQL_DATABASE"'
#           ⚠ 既存データを上書きする。実行前に対象環境を必ず確認すること。
set -euo pipefail
cd "$(dirname "$0")/.."

if ! docker compose ps db --format '{{.Status}}' 2>/dev/null | grep -q '^Up'; then
  echo "db コンテナが起動していません（docker compose ps を確認してください）" >&2
  exit 1
fi

# 🔒 ダンプには session.secret が入る。所有者以外に読ませない（OCL-DA50D148）
umask 077
mkdir -p backups
chmod 700 backups
stamp=$(date +%Y%m%d-%H%M%S)
out="backups/png-jpeg-quiz-${stamp}.sql.gz"

# 認証情報はコンテナ内の env を使う（ホスト側に露出させない）。
# MYSQL_PWD 渡しにして、パスワードをプロセス引数（ps で見える）に載せない
docker compose exec -T db sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump --single-transaction --no-tablespaces -uroot "$MYSQL_DATABASE"' \
  | gzip >"$out"

gunzip -t "$out"
echo "書き出しました: $out ($(du -h "$out" | cut -f1))"
