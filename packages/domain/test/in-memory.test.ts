import { inMemoryPortsCreator } from "../src/in-memory.js";
import { portContract, type Fixture } from "./port-contract.js";

portContract("in-memory", async (data: Fixture) => {
  const { ports, unitOfWork } = inMemoryPortsCreator(data);
  return { ports, unitOfWork, close: async () => {} };
});
