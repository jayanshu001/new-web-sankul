import express from "express";
import cors from "cors";
import morgan from "morgan";
import requestLogger from "./utils/requestLogger";

const app = express();
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  })
);
app.use(morgan("dev"));
app.use(express.json());
app.use(requestLogger);

app.get("/index.php", async (req, res) => {
  res.json({ Project: "Xcelyst" });
});

app.get("/api", (req, res) => {
  res.json({ Project: "Xcelyst" });
});

export default app;
