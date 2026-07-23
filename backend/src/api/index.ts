import express from 'express';
import { authRouter } from './auth.js';
import { dataRouter } from './data.js';
import { mutatorsRouter } from '../mutators/router.js';
import { requireAuth } from '../auth/middleware.js';
import { verifier } from '../auth/verifier.js';

const router = express.Router();

// Auth routes stay open — the client needs them to obtain a token.
router.use('/auth', authRouter);
// Writes require a valid bearer token; see src/auth/verifier.ts to swap providers.
router.use('/data', requireAuth(verifier), dataRouter);
router.use('/mutators', requireAuth(verifier), mutatorsRouter);

export { router as apiRouter };
