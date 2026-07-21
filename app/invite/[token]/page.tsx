import InviteRedeemClient from "./InviteRedeemClient";

export default function InvitePage({ params }: { params: { token: string } }) {
  return (
    <div className="min-h-screen bg-surface-base bg-mesh flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <InviteRedeemClient token={params.token} />
      </div>
    </div>
  );
}
