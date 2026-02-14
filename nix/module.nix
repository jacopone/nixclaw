{ self }:
{ config, lib, pkgs, ... }:
let
  cfg = config.services.nixclaw;
in
{
  options.services.nixclaw = {
    enable = lib.mkEnableOption "NixClaw AI agent";
  };

  config = lib.mkIf cfg.enable {
    # Filled in later
  };
}
