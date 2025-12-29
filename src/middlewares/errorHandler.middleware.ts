import { Request, Response, NextFunction } from "express";

const errorHandler = (err: any, req: Request, res: Response, next: NextFunction): void => {
    const statusCode = err.statusCode || 500;
    
    // Standard error response structure
    const errorResponse: {
        success: boolean;
        statusCode: number;
        message: string;
        stack?: string;
        errors?: any[];
    } = {
        success: false,
        statusCode: statusCode,
        message: err.message || 'Internal Server Error',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        errors: err.errors || undefined // For validation errors
    };

    // Log the error for debugging 
    console.error(`[Error] ${req.method} ${req.originalUrl}:`, err);

    // Handle specific error types 
    if (err.name === 'ValidationError') {
        errorResponse.statusCode = 400;
        errorResponse.message = 'Validation Error';
        // Extract specific validation messages if available
        errorResponse.errors = Object.values(err.errors).map((val: any) => val.message);
    }

    if (err.name === 'CastError') {
        errorResponse.statusCode = 400;
        errorResponse.message = `Resource not found. Invalid: ${err.path}`;
    }

    if (err.code === 11000) {
        errorResponse.statusCode = 400;
        errorResponse.message = `Duplicate field value entered`;
    }

    if (err.name === 'JsonWebTokenError') {
        errorResponse.statusCode = 401;
        errorResponse.message = 'Invalid token. Please log in again.';
    }

    if (err.name === 'TokenExpiredError') {
        errorResponse.statusCode = 401;
        errorResponse.message = 'Your token has expired. Please log in again.';
    }

    // Send the response
    res.status(errorResponse.statusCode).json(errorResponse);
};

export default errorHandler;