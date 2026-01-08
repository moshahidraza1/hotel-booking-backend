import { Router } from "express";
import { verifyJWT, verifyAdmin } from "../middlewares/auth.middleware.js";
import {
    getAdminProfile,
    updateAdminDetails,
    addStaff,
    getAllStaff,
    updateStaffDetails,
    disableStaffAccount,
    enableStaffAccount,
    getAllCustomers,
    disableCustomerAccount,
    enableCustomerAccount,
    getCustomerDetails,
    getDashboardStats,
} from "../controllers/admin.controller.js";

const router = Router();
router.use(verifyJWT);
router.use(verifyAdmin);

router.get('/', getAdminProfile);

router.patch('/update', updateAdminDetails);

router.post('/staff', addStaff);

router.get('/staff', getAllStaff);

//TODO: Add get Staff Details route
router.patch('/staff/:staffId', updateStaffDetails);

router.post('/staff/deactivate', disableStaffAccount);

router.post('/staff/activate', enableStaffAccount);

router.get('/customer', getAllCustomers);

router.post('/customer/deactivate', disableCustomerAccount);

router.post('/customer/activate', enableCustomerAccount);

router.get('/customer/:customerId', getCustomerDetails);

router.get('/dashboard', getDashboardStats);

export default router;

