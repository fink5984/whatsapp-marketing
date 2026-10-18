import { config } from "dotenv";

config();
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.APP_URL = "https://app.test";
process.env.TRACKING_BASE_URL = "https://t.test";
process.env.META_APP_SECRET = "test-platform-app-secret";
process.env.LOG_LEVEL = "error";
process.env.DB_POOL_SIZE = "20";
