/**
 * Email service utilities
 * 
 * MVP: Dev mode - log links to console and return in API response
 * Production: Integrate with SendGrid/Resend/etc.
 */

const IS_DEV = process.env.NODE_ENV !== 'production';

/**
 * Send an invite email
 * In dev mode, logs the link and returns it
 */
export async function sendInviteEmail(
  email: string,
  name: string,
  inviteLink: string
): Promise<void> {
  if (IS_DEV) {
    console.log('\n📧 INVITE EMAIL (DEV MODE)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`To: ${email}`);
    console.log(`Name: ${name}`);
    console.log(`Invite Link: ${inviteLink}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } else {
    // TODO: Integrate with email service (SendGrid, Resend, etc.)
    // Example:
    // await emailService.send({
    //   to: email,
    //   subject: 'You\'ve been invited to join 2Fly',
    //   html: `...`
    // });
    console.log(`[PROD] Would send invite email to ${email}`);
  }
}

/**
 * Send a password reset email
 * In dev mode, logs the link and returns it
 */
export async function sendPasswordResetEmail(
  email: string,
  name: string,
  resetLink: string
): Promise<void> {
  if (IS_DEV) {
    console.log('\n📧 PASSWORD RESET EMAIL (DEV MODE)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`To: ${email}`);
    console.log(`Name: ${name}`);
    console.log(`Reset Link: ${resetLink}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } else {
    // TODO: Integrate with email service
    console.log(`[PROD] Would send password reset email to ${email}`);
  }
}

/**
 * Send login credentials email (PIN-based invite)
 * In dev mode, logs the credentials and returns them
 */
export async function sendCredentialsEmail(
  email: string,
  name: string,
  username: string,
  password: string,
  loginUrl: string
): Promise<void> {
  if (IS_DEV) {
    console.log('\n📧 LOGIN CREDENTIALS EMAIL (DEV MODE)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`To: ${email}`);
    console.log(`Name: ${name}`);
    console.log(`\n🔐 Your Login Credentials:`);
    console.log(`   Username: ${username}`);
    console.log(`   Password: ${password}`);
    console.log(`   (You can also log in with your email: ${email})`);
    console.log(`\n🔗 Login URL: ${loginUrl}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } else {
    // TODO: Integrate with email service
    // Example:
    // await emailService.send({
    //   to: email,
    //   subject: 'Your 2Fly Agency Login Credentials',
    //   html: `
    //     <h2>Welcome to 2Fly, ${name}!</h2>
    //     <p>Your account has been created. Use these credentials to log in:</p>
    //     <p><strong>Username:</strong> ${username}</p>
    //     <p><strong>Password:</strong> ${password}</p>
    //     <p><em>You can also log in using your email: ${email}</em></p>
    //     <p><a href="${loginUrl}">Login here</a></p>
    //   `
    // });
    console.log(`[PROD] Would send credentials email to ${email}`);
  }
}
