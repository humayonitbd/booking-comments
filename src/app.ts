/* eslint-disable no-undef */
/* eslint-disable no-unused-vars */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Application, Request, Response } from 'express';
import globalErrorHandler from './app/middleware/globalErrorhandler';
import notFound from './app/middleware/notfound';
import router from './app/routes';
import path from 'path';
import { serverRunningTemplete } from './templete/templete';
import { paymentController } from './app/modules/payment/payment.controller';

const app: Application = express();


app.post(
  '/api/v1/better-habits-payment-webhook',
  express.raw({ type: 'application/json' }),
  paymentController.conformWebhook,
);

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

//parsers
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  }),
);



app.use('/api/v1', router);

app.get('/', (req: Request, res: Response) => {
  res.send(serverRunningTemplete);
});
app.use(globalErrorHandler);

//Not Found
app.use(notFound);

export default app;

// # Create .env file inside app folder
//                 #   ssh $EC2_USER@$EC2_HOST "cd ~/app && echo 'APP_ENV=$APP_ENV' > .env"

//                 # Create .env file inside app folder
//                 #   echo "$APP_ENV" | ssh $EC2_USER@$EC2_HOST "cat > ~/app/.env"


//                 # Create .env file in app folder
//                 #   ssh $EC2_USER@$EC2_HOST "cat > ~/app/.env" <<'EOF'
//                 #   $APP_ENV
//                 #   EOF

//                 # ssh $EC2_USER@$EC2_HOST "echo \"$APP_ENV\" > ~/app/.env"
