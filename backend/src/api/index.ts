import express from 'express';
import { authRouter } from './auth.js';
import { dataRouter } from './data.js';
import { mutatorsRouter } from '../mutators/router.js';

const router = express.Router();

router.use('/auth', authRouter);
router.use('/data', dataRouter);
router.use('/mutators', mutatorsRouter);

export { router as apiRouter };
