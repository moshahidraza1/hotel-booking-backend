import { prisma } from "../src/db/db.config.js";
import bcrypt from "bcrypt";


const BCRYPT_SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 12);
const isProd = process.env.NODE_ENV === "production";

const ensurePasswordPolicy = (password) => {
    if (!password || password.length < 8) {
        throw new Error("Password must be at least 8 characters long");
    }
};

const hashPassword = (password) => bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

const seedRoles = async() => {
    const validRoles = ["ADMIN", "STAFF", "GUEST"]
    for(const roleName of validRoles){
        await prisma.role.upsert({
            where:{name: roleName},
            update:{},
            create: {name: roleName}
        });
    }

    console.log("Roles seeded");
};

const seedAdmin = async() => {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = ensurePasswordPolicy(process.env.ADMIN_PASSWORD);

    const adminRole = await prisma.role.findUnique({
        where:{name: "ADMIN"}
    });

    const hashedPassword = await hashPassword(adminPassword);

    const admin = await prisma.user.upsert({
        where: {email: adminEmail},
        update: {},
        create: {
            email: adminEmail,
            password: hashedPassword,
            roleId: adminRole.id,
            isEmailVerified: true
        }
    });
    console.log(`Seeded admin: ${admin.email}`);

};

const main = async() => {
    try {
        console.log("Starting Database seed...");
        await seedRoles();
        await seedAdmin();

        console.log("Database seeding completed")

    } catch (error) {
        console.error("Seeding Failed: ", error);
        throw error;
    }
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
})
.finally(async() => {
    await prisma.$disconnect();
})
