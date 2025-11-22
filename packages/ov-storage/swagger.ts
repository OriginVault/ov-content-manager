import swaggerJsdoc, { Options } from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

const swaggerDefinition: Options = {
  openapi: "3.0.0",
  info: { title: "C2PA API", version: "1.0.0" },
  servers: [{ url: "http://localhost:8080" }],
};

const specs = swaggerJsdoc({ swaggerDefinition, apis: ["./server.js"] });

export { specs, swaggerUi }; 