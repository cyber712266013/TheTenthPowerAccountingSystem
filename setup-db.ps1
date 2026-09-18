
$env:DATABASE_URL = ""

# مزامنة Schema
node node_modules/prisma/build/index.js db push --accept-data-loss

# بعد النجاح، شغّل Seed لإنشاء مستخدم admin
node -r ts-node/register prisma/seed.ts
