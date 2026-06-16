import React from "react";

// The (auth) group layout — sign-in and sign-up pages handle
// their own full-page layout, so this is a transparent passthrough.
const AuthLayout = ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => {
  return <>{children}</>;
};

export default AuthLayout;
