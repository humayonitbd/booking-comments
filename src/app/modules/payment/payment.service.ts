import AppError from '../../error/AppError';
import { User } from '../user/user.models';
import { TPayment } from './payment.interface';
import { Payment } from './payment.model';
import QueryBuilder from '../../builder/QueryBuilder';
import moment from 'moment';
import Stripe from 'stripe';
import httpStatus from 'http-status';
import config from '../../config';
import mongoose from 'mongoose';
import { StripeAccount } from '../stripeAccount/stripeAccount.model';
import { withdrawService } from '../withdraw/withdraw.service';
import { Withdraw } from '../withdraw/withdraw.model';
import cron from 'node-cron';
import { notificationService } from '../notification/notification.service';
import axios from 'axios';
import Package from '../package/package.model';
import paypalClient from '../../utils/paypal';
import paypal from '@paypal/checkout-server-sdk';
import Subscription from '../subscription/subscription.model';


type SessionData = Stripe.Checkout.Session;

// console.log({ first: config.stripe.stripe_api_secret });

export const stripe = new Stripe(
  config.stripe.stripe_api_secret as string,
  //      {
  //   apiVersion: '2024-09-30.acacia',
  // }
);

// console.log('stripe==', stripe);

const addPaymentService = async (payload: any) => {
  const session = await mongoose.startSession();
  session.startTransaction();


  try {
    const user = await User.findById(payload.userId).session(session);
    if (!user) {
      throw new AppError(httpStatus.BAD_REQUEST, 'User not found');
    }
    
    const packageExist = await Package.findById(payload.packageId).session(session);
    if (!packageExist) {
      throw new AppError(httpStatus.BAD_REQUEST, 'Package not found');
    }

    const paymentData = {
      userId: user._id,
      method: payload.method,
      amount: packageExist.price,
       status: 'paid',
       transactionId: payload.transactionId,
       transactionDate: new Date(),
       packageId: packageExist._id
    }

    const payment = await Payment.create([paymentData], { session });
  
    await session.commitTransaction();
    session.endSession();
    return payment;
  } catch (error) {
    console.error('Transaction Error:', error);
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};


const createPaypalPaymentService = async (payload: any) => {
  console.log('payload==', payload);
  const session = await mongoose.startSession();
  session.startTransaction();


  // try {
  //   console.log('console-1')
  //   const assecToken = await getPaypalAccessToken();
  //     console.log('assecToken==', assecToken);

  //       const order = await axios.post(
  //         `https://sandbox.paypal.com/v2/checkout/orders`,
  //         {
  //           intent: 'CAPTURE',
  //           purchase_units: [
  //             {
  //               amount: {
  //                 currency_code: 'USD',
  //                 value: '100',
  //               },
  //               metadata: {
  //                 user_id: '12345', 
  //                 source: 'website',
  //                 other_info: 'Additional information here',
  //               },
  //             },
  //           ],
  //         },
  //         {
  //           headers: {
  //             Authorization: `Bearer ${assecToken}`,
  //             'Content-Type': 'application/json',
  //           },
  //         },
  //       );

  //       console.log('order==', order);
  //       console.log('order data==', order.data);
  //       console.log('order data id==', order.data.id);

  //       if (!order.data || !order.data.id) {
  //         throw new AppError(400, 'Order creation failed.');
  //       }

  //       const url = order.data.links.find(
  //         (link: any) => link.rel === 'approve',
  //       );

  //       if (!url) {
  //         throw new AppError(400, 'Order approval link not found.');
  //       }

  //   //     const capture = await axios.post(
  //   //       `${BASE_URL}/v2/checkout/orders/${order.data.id}/capture`,
  //   //       {},
  //   //       {
  //   //         headers: {
  //   //           Authorization: `Bearer ${assecToken}`,
  //   //           'Content-Type': 'application/json',
  //   //         },
  //   //       },
  //   //     );

  //   //     console.log('capture==', capture);

  //   //     if (!capture.data) {
  //   //       throw new AppError(400, 'Capture failed.');
  //   //     }

  //   // Commit transaction
  //   await session.commitTransaction();
  //   session.endSession();
  //   return url;
  // } catch (error) {
  //   console.error('Transaction Error:', error);
  //   await session.abortTransaction();
  //   session.endSession();
  //   throw error;
  // }


  try {
    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: {
            currency_code: 'USD',
            value: payload.amount,
          },
          // description: `Payment for Campaign: ${result._id}`,
          custom_id: payload.userId.toString(),
          // reference_id: ENUM_PAYMENT_PURPOSE.CAMPAIGN_RUN,
        },
      ],
      application_context: {
        brand_name: 'Your Business Name',
        landing_page: 'LOGIN',
        user_action: 'PAY_NOW',
        // return_url: `${config.paypal.payment_capture_url}`,
        // cancel_url: `${config.paypal.paypal_campaign_run_payment_cancel_url}`,
        return_url: `http://10.0.70.163:5002/api/v1/payment/success?orderId=${payload.orderId}`,
        cancel_url: `http://10.0.70.163:5002/api/v1/payment/cancel?orderId=${payload.orderId}`,
      },
    });

    const response = await paypalClient.execute(request);
    const approvalUrl = response.result.links.find(
      (link: any) => link.rel === 'approve',
    )?.href;

    if (!approvalUrl) {
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'PayPal payment creation failed: No approval URL found',
      );
    }

    return { url: approvalUrl };
  } catch (error:any) {
    console.error('PayPal Payment Error:', error);
    throw new AppError(error.statusCode, error.message);
  }


};


const reniewPaypalPaymentService = async (id:string, userId:string) => {
  console.log('id==', id);
  console.log('userId==', userId);
  const session = await mongoose.startSession();
  session.startTransaction();

  
  try {
    const subscription = await Subscription.findById(id);
    if (!subscription) {
      throw new AppError(
        httpStatus.NOT_FOUND,
        'Subscription not found!!',
      );
    }

    if(subscription.userId.toString() !== userId.toString()){
      throw new AppError(httpStatus.BAD_REQUEST, 'You are not valid user for reniew this subscription!!');
    }


    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: {
            currency_code: 'USD',
            value: String(subscription.price),
          },
          // description: `Payment for Campaign: ${result._id}`,
          custom_id: userId.toString(),
          // reference_id: ENUM_PAYMENT_PURPOSE.CAMPAIGN_RUN,
        },
      ],
      application_context: {
        brand_name: 'Your Business Name',
        landing_page: 'LOGIN',
        user_action: 'PAY_NOW',
        // return_url: `${config.paypal.payment_capture_url}`,
        // cancel_url: `${config.paypal.paypal_campaign_run_payment_cancel_url}`,
        return_url: `http://10.0.70.163:5002/api/v1/payment/reniew-success?subscriptionId=${subscription._id}`,
        cancel_url: `http://10.0.70.163:5002/api/v1/payment/reniew-cancel?subscriptionId=${subscription._id}`,
      },
    });

    const response = await paypalClient.execute(request);
    const approvalUrl = response.result.links.find(
      (link: any) => link.rel === 'approve',
    )?.href;

    if (!approvalUrl) {
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'PayPal payment creation failed: No approval URL found',
      );
    }

    return { url: approvalUrl };
  } catch (error:any) {
    console.error('PayPal Payment Error:', error);
    throw new AppError(
      error.statusCode,
      error.message,
    );
  }
};


// Refund Service Function
const refundPaypalPaymentService = async (
  captureId: string,
  amount?: number, 
) => {
  try {

    console.log('captureId==', captureId);
    console.log('amount==', amount);
    if (!captureId) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        'Capture ID is required for refund.',
      );
    }
    if (amount && amount <= 0) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        'Refund amount must be greater than zero.',
      );
    }
    const refundRequest = new paypal.payments.CapturesRefundRequest(captureId);

    const requestBody: any = {
      amount: {
        currency_code: 'USD',
        value: amount ? amount.toFixed(2) : '0.00',
      },
    };

    refundRequest.requestBody(requestBody);

    const response = await paypalClient.execute(refundRequest);

    if (response.statusCode === 201 && response.result.status === 'COMPLETED') {
      return "Refund successful.";
    } else {
      return {
        success: false,
        message: 'Refund failed.',
        error: response.result || 'Unknown error',
      };
    }
  } catch (error: any) {
    console.error('PayPal Refund Error:', error);

    if (error instanceof AppError) {
      throw error;
    }

    if (error.statusCode && error.message) {
      throw new AppError(error.statusCode, error.message);
    } 
  }
};



const getAllPaymentService = async (query: Record<string, unknown>) => {
  const PaymentQuery = new QueryBuilder(
    Payment.find({}).populate('userId').populate('orderId'),
    query,
  )
    .search([''])
    .filter()
    .sort()
    .paginate()
    .fields();

  const result = await PaymentQuery.modelQuery;
  const meta = await PaymentQuery.countTotal();
  return { meta, result };
};
const getAllPaymentByCustomerService = async (
  query: Record<string, unknown>,
  customerId: string,
) => {
  const PaymentQuery = new QueryBuilder(
    Payment.find({ customerId, status: 'paid' }).populate({
      path: 'serviceId',
      select: 'serviceName servicePrice',
      populate: { path: 'businessId', select: 'businessName' },
    }),
    // .populate('businessId'),
    query,
  )
    .search(['name'])
    .filter()
    .sort()
    .paginate()
    .fields();

  const result = await PaymentQuery.modelQuery;
  const meta = await PaymentQuery.countTotal();
  return { meta, result };
};

const singlePaymentService = async (id: string) => {
  const task = await Payment.findById(id);
  return task;
};

const deleteSinglePaymentService = async (id: string) => {
  const result = await Payment.deleteOne({ _id: id });
  return result;
};

const getAllIncomeRatio = async (year: number) => {
  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year + 1, 0, 1);

  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    totalIncome: 0,
  }));

  // console.log({ months });

  const incomeData = await Payment.aggregate([
    {
      $match: {
        transactionDate: { $gte: startOfYear, $lt: endOfYear },
      },
    },
    {
      $group: {
        _id: { month: { $month: '$transactionDate' } },
        totalIncome: { $sum: '$amount' },
      },
    },
    {
      $project: {
        month: '$_id.month',
        totalIncome: 1,
        _id: 0,
      },
    },
    {
      $sort: { month: 1 },
    },
  ]);

  incomeData.forEach((data) => {
    const monthData = months.find((m) => m.month === data.month);
    if (monthData) {
      monthData.totalIncome = data.totalIncome;
    }
  });

  // console.log({ months });

  return months;
};

// const getAllIncomeRatiobyDays = async (days: string) => {
//   const currentDay = new Date();
//   let startDate: Date;

//   if (days === '7day') {
//     startDate = new Date(currentDay.getTime() - 7 * 24 * 60 * 60 * 1000);
//   } else if (days === '24hour') {
//     startDate = new Date(currentDay.getTime() - 24 * 60 * 60 * 1000);
//   } else {
//     throw new Error("Invalid value for 'days'. Use '7day' or '24hour'.");
//   }


//   const timeSlots =
//     days === '7day'
//       ? Array.from({ length: 7 }, (_, i) => {
//           const day = new Date(currentDay.getTime() - i * 24 * 60 * 60 * 1000);
//           return {
//             date: day.toISOString().split('T')[0],
//             totalIncome: 0,
//           };
//         }).reverse()
//       : Array.from({ length: 24 }, (_, i) => {
//           const hour = new Date(currentDay.getTime() - i * 60 * 60 * 1000);
//           return {
//             hour: hour.toISOString(),
//             totalIncome: 0,
//           };
//         }).reverse();

//   const incomeData = await Payment.aggregate([
//     {
//       $match: {
//         transactionDate: { $gte: startDate, $lte: currentDay },
//       },
//     },
//     {
//       $group: {
//         _id:
//           days === '7day'
//             ? {
//                 date: {
//                   $dateToString: {
//                     format: '%Y-%m-%d',
//                     date: '$transactionDate',
//                   },
//                 },
//               }
//             : {
//                 hour: {
//                   $dateToString: {
//                     format: '%Y-%m-%dT%H:00:00',
//                     date: '$transactionDate',
//                   },
//                 },
//               },
//         totalIncome: { $sum: '$amount' },
//       },
//     },
//     // {
//     //   $project: {
//     //     dateHour: days === '7day' ? '$_id.date' : null,
//     //     dateHour: days === '24hour' ? '$_id.hour' : null,
//     //     totalIncome: 1,
//     //     _id: 0,
//     //   },
//     // },
//     {
//   $project: {
//     dateHour: {
//       $cond: {
//         if: { $eq: [days, '7day'] },
//         then: '$_id.date', // For 7day, use the date field
//         else: '$_id.hour', // For 24hour, use the hour field
//       },
//     },
//     totalIncome: 1,
//     _id: 0,
//   },
// },
//     {
//       $sort: { [days === '7day' ? 'date' : 'hour']: 1 },
//     },
//   ]);

//   incomeData.forEach((data) => {
//     if (days === '7day') {
//       const dayData = timeSlots.find((d: any) => d.date === data.date);
//       if (dayData) {
//         dayData.totalIncome = data.totalIncome;
//       }
//     } else if (days === '24hour') {
//       const hourData = timeSlots.find((h: any) => h.hour === data.hour);
//       if (hourData) {
//         hourData.totalIncome = data.totalIncome;
//       }
//     }
//   });

//   return timeSlots;
// };

const getAllIncomeRatiobyDays = async (days: string) => {
  const currentDay = new Date();
  let startDate: Date;

  if (days === '7day') {
    startDate = new Date(currentDay.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (days === '24hour') {
    startDate = new Date(currentDay.getTime() - 24 * 60 * 60 * 1000);
  } else {
    throw new Error("Invalid value for 'days'. Use '7day' or '24hour'.");
  }

  const timeSlots =
    days === '7day'
      ? Array.from({ length: 7 }, (_, i) => {
          const day = new Date(currentDay.getTime() - i * 24 * 60 * 60 * 1000);
          return {
            dateHour: day.toISOString().split('T')[0],
            totalIncome: 0,
          };
        }).reverse()
      : Array.from({ length: 24 }, (_, i) => {
          const hour = new Date(currentDay.getTime() - i * 60 * 60 * 1000);
          return {
            dateHour: hour.toISOString(),
            totalIncome: 0,
          };
        }).reverse();

  const incomeData = await Payment.aggregate([
    {
      $match: {
        transactionDate: { $gte: startDate, $lte: currentDay },
      },
    },
    {
      $group: {
        _id:
          days === '7day'
            ? {
                date: {
                  $dateToString: {
                    format: '%Y-%m-%d',
                    date: '$transactionDate',
                  },
                },
              }
            : {
                hour: {
                  $dateToString: {
                    format: '%Y-%m-%dT%H:00:00',
                    date: '$transactionDate',
                  },
                },
              },
        totalIncome: { $sum: '$amount' },
      },
    },
    {
      $project: {
        dateHour: days === '7day' ? '$_id.date' : '$_id.hour', // Rename to 'dateHour'
        totalIncome: 1,
        _id: 0,
      },
    },
    {
      $sort: { [days === '7day' ? 'date' : 'hour']: 1 },
    },
  ]);

  incomeData.forEach((data) => {
    if (days === '7day') {
      const dayData = timeSlots.find((d: any) => d.dateHour === data.dateHour);
      if (dayData) {
        dayData.totalIncome = data.totalIncome;
      }
    } else if (days === '24hour') {
      const hourData = timeSlots.find((h: any) => h.dateHour === data.dateHour);
      if (hourData) {
        hourData.totalIncome = data.totalIncome;
      }
    }
  });

  return timeSlots;
};



const createCheckout = async (userId: any, payload: any) => {
  console.log('stripe payment', payload);
  let session = {} as { id: string };



  const lineItems = [
    {
      price_data: {
        currency: 'usd',
        product_data: {
          name: 'Amount',
        },
        unit_amount: Math.round(payload.amount * 100),
      },
      quantity: 1,
    },
  ];

  console.log('lineItems=', lineItems);

  const sessionData: any = {
    payment_method_types: ['card'],
    mode: 'payment',
    success_url: `http://3.114.93.108:8078/api/v1/payment/success`,
    cancel_url: `http://3.114.93.108:8078/api/v1/payment/cancel`,
    line_items: lineItems,
    metadata: {
      userId: String(userId),
      orderId: String(payload.orderId),
      cartIds: JSON.stringify(payload.cartIds),
    },
  };

  console.log('sessionData=', sessionData);

  try {
    console.log('try session');
    session = await stripe.checkout.sessions.create(sessionData);
    console.log('session==', session);

  } catch (error) {
    console.log('Error', error);
  }

  console.log('try session 22');
  const { id: session_id, url }: any = session || {};

  console.log({ url });

  return { url };
};

const automaticCompletePayment = async (event: Stripe.Event): Promise<void> => {


  // try {
  //   switch (event.type) {
  //     case 'checkout.session.completed': {
  //       console.log(
  //         'hit hise webhook controller servie checkout.session.completed',
  //       );
  //       const sessionData = event.data.object as Stripe.Checkout.Session;
  //       const {
  //         id: sessionId,
  //         payment_intent: paymentIntentId,
  //         metadata,
  //       }: SessionData = sessionData;
  //       const orderId = metadata?.orderId as string;
  //       const userId = metadata?.userId as string;
  //       const cartIds = JSON.parse(metadata?.cartIds as any);
  //       console.log('cartIds==', cartIds);

  //       if (!paymentIntentId) {
  //         throw new AppError(
  //           httpStatus.BAD_REQUEST,
  //           'Payment Intent ID not found in session',
  //         );
  //       }

  //       const paymentIntent = await stripe.paymentIntents.retrieve(
  //         paymentIntentId as string,
  //       );

  //       if (!paymentIntent || paymentIntent.amount_received === 0) {
  //         throw new AppError(httpStatus.BAD_REQUEST, 'Payment Not Successful');
  //       }

       
  //       const order = await Order.findByIdAndUpdate(
  //         orderId,
  //         { paymentStatus: 'paid', status: 'completed' },
  //         { new: true },
  //       );

  //       if (!order) {
  //         throw new AppError(httpStatus.BAD_REQUEST, 'Order not found');
  //       }

  //       const productlist = await Promise.all(
  //         order.productList.map(async (product: any) => {
  //           const singleProduct: any = await Product.findById(
  //             product.productId,
  //           );

  //           if (!singleProduct) {
  //             throw new AppError(404, 'Product is not Found!!');
  //           }

  //           if (singleProduct.availableStock < product.quantity) {
  //             throw new AppError(403, 'Stock is not available!!');
  //           }

  //           const updatedProduct = await Product.findOneAndUpdate(
  //             {
  //               _id: product.productId,
  //               availableStock: { $gte: product.quantity },
  //             }, 
  //             { $inc: { availableStock: -product.quantity } }, 
  //             { new: true },
  //           );

  //           if (!updatedProduct) {
  //             throw new AppError(403, 'Insufficient stock after retry');
  //           }

  //           return updatedProduct;
  //         }),
  //       );

  //       console.log('===order', order);

  //       const paymentData: any = {
  //         userId: userId,
  //         amount: order?.totalAmount,
  //         method: 'stripe',
  //         transactionId: paymentIntentId,
  //         orderId: order?._id,
  //         status: 'paid',
  //         session_id: sessionId,
  //         transactionDate: order?.orderDate,
  //       };

  //       const payment = await Payment.create(paymentData);
  //       console.log('===payment', payment);

  //       if (!payment) {
  //         throw new AppError(
  //           httpStatus.BAD_REQUEST,
  //           'Payment record creation failed',
  //         );
  //       }
  //       const user = await User.findById(userId);
  //       if (!user) {
  //         throw new AppError(httpStatus.BAD_REQUEST, 'User not found');
  //       }

  //        const pickupAddress = await PickupAddress.findOne({});
  //         if (!pickupAddress) {
  //           throw new AppError(400, 'Pickup Address is not found!');  
  //         }
  //         const heightAndWidthAndLength = await calculateShippingBox(order.productList);
        
  //         const productItems = await Promise.all(
  //           order.productList.map(async (productItem: any) => {
  //             const product = await Product.findById(productItem.productId);
        
  //             if (!product) {
  //               throw new AppError(400, 'Product not found for this cart item');
  //             }
        
  //             return {
  //               weight: Number(product.weight),
  //               value: productItem.price,
  //               quantity: productItem.quantity,
  //               description: 'string',
  //             };
  //           }),
  //         );

        
  //           const shipmentRequestData = {
  //             width: 80 < Math.ceil(heightAndWidthAndLength.avgWidth) ? 80 : Math.ceil(heightAndWidthAndLength.avgWidth), 
  //             preferred_service_level: 'any:most_efficient',
  //             // preferred_service_level: 'post_nl:cheapest',
  //             pickup_address: {
  //               zip_code: pickupAddress.zip_code,
  //               street_name: pickupAddress.street_name,
  //               state_code: pickupAddress.state_code,
  //               phone_number: pickupAddress.phone_number,
  //               locality: pickupAddress.locality,
  //               house_number: pickupAddress.house_number,
  //               given_name: pickupAddress.given_name,
  //               family_name: pickupAddress.family_name,
  //               email_address: pickupAddress.email_address,
  //               country: pickupAddress.country,
  //               business: pickupAddress.business,
  //               address2: pickupAddress.address2,
  //             },
  //             personal_message: 'A very personal message',
  //             // parcelshop_id: 'POST_NL:1234',
  //             order_lines: productItems,
  //             meta: {},
  //             length: 120 < Math.ceil(heightAndWidthAndLength.avgLength) ? 120 : Math.ceil(heightAndWidthAndLength.avgLength), // in centimeters
  //             kind: 'package',
  //             is_return: false,
  //             height: 80 < Math.ceil(heightAndWidthAndLength.avgHeight) ? 80 : Math.ceil(heightAndWidthAndLength.avgHeight), // in centimeters
  //             drop_off: false,
  //             description: 'description',
  //             delivery_address: {
  //               zip_code: order.zip_code,
  //               street_name: order.street_name,
  //               state_code: order.state_code,
  //               phone_number: order.phone_number,
  //               locality: order.locality,
  //               house_number: order.house_number,
  //               given_name: order.given_name,
  //               family_name: order.family_name,
  //               email_address: user.email,
  //               country: order.country,
  //               business: order.business,
  //               address2: order.address2,
  //             },
  //             delivery_instructions: 'delivery instructions',
  //             customer_reference: 'W202301',
  //           };
        
  //           console.log('shipmentRequestData===========', shipmentRequestData);
        
           
        
  //           // const shipmentRequestBooking = await wearewuunderApiRequest(
  //           //   'shipments',
  //           //   'POST',
  //           //   shipmentRequestData,
  //           // );

           

  //           try {
  //             const shipmentRequestBooking = await axios.post(
  //               'https://api.wearewuunder.com/api/v2/shipments',
  //               shipmentRequestData,
  //               {
  //                 headers: {
  //                   // Authorization: `Bearer ${config.shipment_key}`,
  //                   Authorization: `Bearer 7EyVLQIcx2Ul6PISQaTba0Mr96geTdP6`,
  //                   'Content-Type': 'application/json',
  //                 },
  //               },
  //             );

  //             // const shipmentRequestBooking = await wearewuunderApiRequest(
  //             //   'shipments',
  //             //   'POST',
  //             //   shipmentRequestData,
  //             // );
  //             console.log(
  //               'shipmentRequestBooking==*****',
  //               shipmentRequestBooking,
  //             );

  //             if (shipmentRequestBooking.status === 201) {
  //               const data = {
  //                 shipmentRequestId: shipmentRequestBooking.data.id,
  //               };

  //               const shipingApi = await ShipmentRequestApi.create(data);
  //               console.log('shipingApi', shipingApi);
  //               const order = await Order.findByIdAndUpdate(
  //                 orderId,
  //                 { trackUrl: shipmentRequestBooking.data.track_and_trace_url },
  //                 { new: true },
  //               );

  //               if (!order) {
  //                 throw new AppError(httpStatus.BAD_REQUEST, 'Order not found');
  //               }

  //               if (!shipingApi) {
  //                 throw new AppError(400, 'ShipmentRequestApi creqate failed!');
  //               }
  //             }
  //           } catch (error:any) {
  //             console.log('error==', error);

  //             console.error('Error Response:', {
  //               status: error.response.status,
  //               data: error.response.data,
  //               headers: error.response.headers,
  //               // url: url,
  //               // method: method,
  //               // errors: error.response.data.errors.map(
  //               //   (errorItem: any) => errorItem.messages,
  //               // ),
  //               message: error.response.data[0]?.message,
  //             });


  //             if(error){
  //               const order = await Order.findByIdAndUpdate(
  //                 orderId,
  //                 { error: 'post code is not valid!!' },
  //                 { new: true },
  //               );
  //             }
              
  //           }


  //       const deletedCartProducts = await Promise.all(
  //         cartIds.map(async (cartProductId: any) => {
  //           const isDelete =
  //             await Cart.findByIdAndDelete(cartProductId);
  //           if (!isDelete) {
  //             throw new AppError(404, 'Failed to delete cart product');
  //           }
  //         }),
  //       );

  //       const notificationData = {
  //         userId: userId,
  //         message: 'Order create successfull!!',
  //         type: 'success',
  //       };

  //       const notificationData1 = {
  //         role: 'admin',
  //         message: 'New Order create successfull!!',
  //         type: 'success',
  //       };

  //       const [notification, notification1] = await Promise.all([
  //         notificationService.createNotification(notificationData),
  //         notificationService.createNotification(notificationData1),
  //       ]);

  //       if (!notification || !notification1) {
  //         throw new AppError(404, 'Notification create faild!!');
  //       }

  //       const deletedServiceBookings = await Order.deleteMany(
  //         {
  //           userId,
  //           status: 'pending',
  //         }
  //       );
  //       console.log('deletedServiceBookings', deletedServiceBookings);

        

  //       console.log('Payment completed successfully:', {
  //         sessionId,
  //         paymentIntentId,
  //       });

  //       break;
  //     }

  //     case 'checkout.session.async_payment_failed': {
  //       const session = event.data.object as Stripe.Checkout.Session;
  //       const clientSecret = session.client_secret;
  //       const sessionId = session.id;

  //       if (!clientSecret) {
  //         console.warn('Client Secret not found in session.');
  //         throw new AppError(httpStatus.BAD_REQUEST, 'Client Secret not found');
  //       }

  //       // const payment = await Payment.findOne({ session_id: sessionId });

  //       // if (payment) {
  //       //   payment.status = 'Failed';
  //       //   await payment.save();
  //       //   // console.log('Payment marked as failed:', { clientSecret });
  //       // } else {
  //       //   console.warn(
  //       //     'No Payment record found for Client Secret:',
  //       //     clientSecret,
  //       //   );
  //       // }

  //       break;
  //     }

  //     default:
  //       // // console.log(`Unhandled event type: ${event.type}`);
  //       // res.status(400).send();
  //       return;
  //   }
  // } catch (err) {
  //   console.error('Error processing webhook event:', err);
  // }
};

// const paymentRefundService = async (
//   amount: number | null,
//   payment_intent: string,
// ) => {
//   const refundOptions: Stripe.RefundCreateParams = {
//     payment_intent,
//   };

//   // Conditionally add the `amount` property if provided
//   if (amount) {
//     refundOptions.amount = Number(amount);
//   }

//   // console.log('refaund options', refundOptions);

//   const result = await stripe.refunds.create(refundOptions);
//   // console.log('refund result ', result);
//   return result;
// };

const getAllEarningRatio = async (year: number, businessId: string) => {
  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year + 1, 0, 1);

  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    totalIncome: 0,
  }));

  // console.log({ months });

  const incomeData = await Payment.aggregate([
    {
      $match: {
        status: 'complete',
        transactionDate: { $gte: startOfYear, $lt: endOfYear },
      },
    },
    {
      $group: {
        _id: { month: { $month: '$transactionDate' } },
        totalIncome: { $sum: '$amount' },
      },
    },
    {
      $project: {
        month: '$_id.month',
        totalIncome: 1,
        _id: 0,
      },
    },
    {
      $sort: { month: 1 },
    },
  ]);

  incomeData.forEach((data) => {
    const monthData = months.find((m) => m.month === data.month);
    if (monthData) {
      monthData.totalIncome = data.totalIncome;
    }
  });

  return months;
};

// const refreshAccountConnect = async (
//   id: string,
//   host: string,
//   protocol: string,
// ): Promise<string> => {
//   const onboardingLink = await stripe.accountLinks.create({
//     account: id,
//     refresh_url: `${protocol}://${host}/api/v1/payment/refreshAccountConnect/${id}`,
//     return_url: `${protocol}://${host}/api/v1/payment/success-account/${id}`,
//     type: 'account_onboarding',
//   });
//   return onboardingLink.url;
// };

// const createStripeAccount = async (
//   user: any,
//   host: string,
//   protocol: string,
// ): Promise<any> => {
//   // console.log('user',user);
//   const existingAccount = await StripeAccount.findOne({
//     userId: user.userId,
//   }).select('user accountId isCompleted');
//   // console.log('existingAccount', existingAccount);

//   if (existingAccount) {
//     if (existingAccount.isCompleted) {
//       return {
//         success: false,
//         message: 'Account already exists',
//         data: existingAccount,
//       };
//     }

//     const onboardingLink = await stripe.accountLinks.create({
//       account: existingAccount.accountId,
//       refresh_url: `${protocol}://${host}/api/v1/payment/refreshAccountConnect/${existingAccount.accountId}`,
//       return_url: `${protocol}://${host}/api/v1/payment/success-account/${existingAccount.accountId}`,
//       type: 'account_onboarding',
//     });
//     // console.log('onboardingLink-1', onboardingLink);

//     return {
//       success: true,
//       message: 'Please complete your account',
//       url: onboardingLink.url,
//     };
//   }

//   const account = await stripe.accounts.create({
//     type: 'express',
//     email: user.email,
//     country: 'US',
//     capabilities: {
//       card_payments: { requested: true },
//       transfers: { requested: true },
//     },
//   });
//   // console.log('stripe account', account);

//   await StripeAccount.create({ accountId: account.id, userId: user.userId });

//   const onboardingLink = await stripe.accountLinks.create({
//     account: account.id,
//     refresh_url: `${protocol}://${host}/api/v1/payment/refreshAccountConnect/${account.id}`,
//     return_url: `${protocol}://${host}/api/v1/payment/success-account/${account.id}`,
//     type: 'account_onboarding',
//   });
//   // console.log('onboardingLink-2', onboardingLink);

//   return {
//     success: true,
//     message: 'Please complete your account',
//     url: onboardingLink.url,
//   };
// };

// const transferBalanceService = async (
//   accountId: string,
//   amt: number,
//   userId: string,
// ) => {
//   const withdreawAmount = await availablewithdrawAmount('stripe', userId);
//   // console.log('withdreawAmount===', withdreawAmount[0].totalAmount);

//   if (withdreawAmount[0].totalAmount < 0) {
//     throw new AppError(httpStatus.BAD_REQUEST, 'Amount must be positive');
//   }
//   const amount = withdreawAmount[0].totalAmount * 100;
//   const transfer = await stripe.transfers.create({
//     amount,
//     currency: 'usd',
//     destination: accountId,
//   });
//   // console.log('transfer', transfer);
//   if (!transfer) {
//     throw new AppError(httpStatus.BAD_REQUEST, 'Transfer failed');
//   }
//   let withdraw;
//   if (transfer) {
//     const withdrawData: any = {
//       transactionId: transfer.id,
//       amount: withdreawAmount[0].totalAmount,
//       method: 'stripe',
//       status: 'completed',
//       businessId: userId,
//       destination: transfer.destination,
//     };

//     withdraw = withdrawService.addWithdrawService(withdrawData);
//     if (!withdraw) {
//       throw new AppError(httpStatus.BAD_REQUEST, 'Withdrawal failed');
//     }
//   }
//   return withdraw;
// };
// 0 0 */7 * *

// cron.schedule('* * * * *', async () => {
//   // console.log('Executing transferBalanceService every 7 days...');
//   const businessUser = await User.find({
//     role: 'business',
//     isDeleted: false,
//   });
//   // console.log('businessUser==', businessUser);

//   for (const user of businessUser) {
//     // console.log('usr=====');
//     const isExiststripeAccount:any = await StripeAccount.findOne({
//       userId: user._id,
//       isCompleted: true,
//     });
//     // console.log('isExiststripeAccount', isExiststripeAccount);

//     if (!isExiststripeAccount) {
//       throw new AppError(httpStatus.BAD_REQUEST, 'Account not found');
//     }

//      // console.log('=====1')
//     await transferBalanceService(
//       isExiststripeAccount.accountId,
//       0,
//       isExiststripeAccount.userId,
//     );
//     // console.log('=====2');
//   }

//   // await transferBalanceService();
// });

export const paymentService = {
  addPaymentService,
  createPaypalPaymentService,
  reniewPaypalPaymentService,
  refundPaypalPaymentService,
  getAllPaymentService,
  singlePaymentService,
  deleteSinglePaymentService,
  getAllPaymentByCustomerService,
  getAllIncomeRatio,
  getAllIncomeRatiobyDays,
  createCheckout,
  automaticCompletePayment,
  getAllEarningRatio,
  //   paymentRefundService,
  //   filterBalanceByPaymentMethod,
  //   filterWithdrawBalanceByPaymentMethod,
  //   createStripeAccount,
  //   refreshAccountConnect,
  //   transferBalanceService,
};
