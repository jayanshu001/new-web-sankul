import { Request, Response } from "express";
import { success, failure } from "../utils/httpResponse";

const notFoundMiddleware = (req: Request, res: Response) => 
{
    return failure(res,"Not found", 404);
}

export default notFoundMiddleware

