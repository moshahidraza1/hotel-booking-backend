import express from 'express';
import roomTypeRouter from './routes/roomType.routes.js';
import roomUnitRouter from './routes/roomUnit.routes.js';
import ammenityRouter from './routes/ammenity.routes.js';
import inventoryRouter from './routes/inventory.routes.js';

const app = express()

app.use(express.json())

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.use('/api/v1/room-type', roomTypeRouter);
app.use('/api/v1/room-unit', roomUnitRouter);
app.use('/api/v1/ammenities', ammenityRouter);
app.use('/api/v1/inventory', inventoryRouter);

export { app }
