import express from 'express'
import adminRouter from './routes/admin.routes.js';
import userRouter from './routes/user.routes.js';
import roomTypeRouter from './routes/roomType.routes.js';
import roomUnitRouter from './routes/roomUnit.routes.js';
const app = express()

app.use(express.json())

app.get('/', (req, res) => {
  res.send('Hello World!')
})
app.use('/api/v1/user', userRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/room-unit', roomTypeRouter);
app.use('/api/v1/room-unit', roomUnitRouter);

export { app }
