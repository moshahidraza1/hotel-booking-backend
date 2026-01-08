import { ApiError } from "../utils/ApiError.js";


export const validate = (schema) => (req, res, next) => {

    const result = schema.safeParse({
        body: req.body,
        query: req.query,
        params: req.params,
    });

    if (!result.success) {
        const errorMessages = result.error.errors.map((err) => {
            const path = err.path.join(".");
            return `${path ? path + ": " : ""}${err.message}`;
        });

        return next(new ApiError(400, errorMessages.join(" | ")));
    }

    if (result.data.body) req.body = result.data.body;
    if (result.data.query) req.query = result.data.query;
    if (result.data.params) req.params = result.data.params;

    next();
};
