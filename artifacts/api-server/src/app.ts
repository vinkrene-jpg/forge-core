import { existsSync } from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

const frontendDist = path.resolve(
  process.cwd(),
  "artifacts/forge-core/dist/public",
);

if (existsSync(frontendDist)) {
  app.use(
    express.static(frontendDist, {
      index: false,
      maxAge:
        process.env.NODE_ENV === "production"
          ? 60 * 60 * 1_000
          : 0,
    }),
  );

  app.use((req, res, next): void => {
    if (
      req.method !== "GET" ||
      req.path.startsWith("/api")
    ) {
      next();
      return;
    }

    res.sendFile("index.html", { root: frontendDist });
  });
}

export default app;