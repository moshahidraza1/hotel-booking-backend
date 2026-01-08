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
import {
    updateAdminDetailsSchema,
    changePasswordSchema,
    addStaffSchema,
    updateStaffDetailsSchema,
    deactivateStaffSchema,
    activateStaffSchema,
    deactivateCustomerSchema,
    activateCustomerSchema,
    getCustomerDetailsSchema,
    paginationSchema,
} from "../validators/admin.validator.js";
import { validate } from "../middlewares/validator.middleware.js";


const router = Router();
router.use(verifyJWT);
router.use(verifyAdmin);

router.get('/', getAdminProfile);

router.patch('/update', validate(updateAdminDetailsSchema), updateAdminDetails);

// Staff Management Routes
router.post('/staff', validate(addStaffSchema) , addStaff);
router.get('/staff', validate(paginationSchema), getAllStaff);
//TODO: Add get Staff Details route
router.patch('/staff/:staffId', validate(updateStaffDetailsSchema),  updateStaffDetails);
router.post('/staff/deactivate', validate(deactivateStaffSchema),  disableStaffAccount);
router.post('/staff/activate', validate(activateStaffSchema), enableStaffAccount);

// Customer Management Routes
router.get('/customer', validate(paginationSchema), getAllCustomers);
router.post('/customer/deactivate', validate(deactivateCustomerSchema), disableCustomerAccount);
router.post('/customer/activate', validate(activateCustomerSchema),  enableCustomerAccount);
router.get('/customer/:customerId', validate(getCustomerDetailsSchema), getCustomerDetails);

//Dashboard Route
router.get('/dashboard',  getDashboardStats);

export default router;

