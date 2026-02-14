{
  description = "NixClaw - Personal AI agent platform for NixOS";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in
    {
      packages.${system}.default = pkgs.buildNpmPackage {
        pname = "nixclaw";
        version = "0.1.0";
        src = ./.;
        npmDepsHash = "";
        nodejs = pkgs.nodejs_22;
        installPhase = ''
          runHook preInstall
          mkdir -p $out/bin $out/lib/nixclaw
          cp -r dist/* $out/lib/nixclaw/
          cp -r node_modules $out/lib/nixclaw/
          cat > $out/bin/nixclaw <<EOF
          #!/bin/sh
          exec ${pkgs.nodejs_22}/bin/node $out/lib/nixclaw/index.js "\$@"
          EOF
          chmod +x $out/bin/nixclaw
          runHook postInstall
        '';
      };

      nixosModules.default = import ./nix/module.nix { inherit self; };

      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [
          nodejs_22
          nodePackages.typescript
          nodePackages.typescript-language-server
        ];
      };
    };
}
