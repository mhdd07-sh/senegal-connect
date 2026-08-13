const bcrypt = require("bcrypt");

const utilisateurs = [
    {
        email: "admin@senegalconnect.sn",
        password: "Admin123!"
    },
    {
        email: "cheikh.agent@senegalconnect.sn",
        password: "Agent123!"
    },
    {
        email: "bineta.agent@senegalconnect.sn",
        password: "Agent456!"
    },
    {
        email: "moussa.sow@example.sn",
        password: "Client123!"
    },
    {
        email: "fatou.ba@example.sn",
        password: "Client456!"
    },
    {
        email: "ibrahima.diallo@example.sn",
        password: "Client789!"
    },
    {
        email: "awa.sarr@example.sn",
        password: "Client321!"
    },
    {
        email: "modou.gueye@example.sn",
        password: "Client654!"
    }
];

async function generateHashes() {
    try {
        console.log("Génération des hash bcrypt...\n");

        for (const utilisateur of utilisateurs) {
            const hash = await bcrypt.hash(utilisateur.password, 12);

            console.log(`Email : ${utilisateur.email}`);
            console.log(`Mot de passe : ${utilisateur.password}`);
            console.log(`Hash : ${hash}`);
            console.log("------------------------------------------");
        }

        console.log("\nTous les hash ont été générés avec succès.");
    } catch (error) {
        console.error("Erreur lors de la génération des hash :", error);
    }
}

generateHashes();